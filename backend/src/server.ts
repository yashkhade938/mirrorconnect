import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import bcrypt from "bcryptjs";
import compression from "compression";
import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import morgan from "morgan";
import { Prisma, PrismaClient, SessionStatus } from "@prisma/client";
import QRCode from "qrcode";
import { Server, Socket } from "socket.io";
import { z } from "zod";
import {
  IceServer,
  Role,
  SocketAuth,
  isSessionId,
  sanitizeDeviceName,
} from "@mirrorconnect/shared";

// 10. Environment Variable Schema & Validation
const envSchema = z.object({
  PORT: z.string().default("4000").transform(Number),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  SESSION_TTL_SECONDS: z.string().default("300").transform(Number),
  INACTIVITY_TIMEOUT_SECONDS: z.string().default("120").transform(Number),
  JWT_SECRET: z.string().min(16).default("mirrorconnect-default-production-jwt-secret-key-32chars"),
  PUBLIC_APP_URL: z.string().default("http://localhost:3000"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3000"),
  DATABASE_URL: z.string().optional(),
  STUN_URL: z.string().default("stun:stun.l.google.com:19302"),
  TURN_URL: z.string().optional(),
  TURN_USERNAME: z.string().optional(),
  TURN_CREDENTIAL: z.string().optional(),
});

const envParseResult = envSchema.safeParse(process.env);
if (!envParseResult.success) {
  console.error("❌ Environment configuration validation failed:", envParseResult.error.format());
  process.exit(1);
}

const env = envParseResult.data;
const IS_DEV = env.NODE_ENV !== "production";
const PORT = env.PORT;
const SESSION_TTL_MS = env.SESSION_TTL_SECONDS * 1000;
const INACTIVITY_MS = env.INACTIVITY_TIMEOUT_SECONDS * 1000;
const JWT_SECRET = env.JWT_SECRET;
const PUBLIC_APP_URL = env.PUBLIC_APP_URL;

// 8. Structured Logging Utility
const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (IS_DEV) {
      console.log(`[INFO] ${msg}`, meta ? JSON.stringify(meta) : "");
    } else {
      console.log(JSON.stringify({ level: "info", time: new Date().toISOString(), message: msg, ...meta }));
    }
  },
  warn: (msg: string, meta?: Record<string, unknown>) => {
    if (IS_DEV) {
      console.warn(`[WARN] ${msg}`, meta ? JSON.stringify(meta) : "");
    } else {
      console.warn(JSON.stringify({ level: "warn", time: new Date().toISOString(), message: msg, ...meta }));
    }
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    if (IS_DEV) {
      console.error(`[ERROR] ${msg}`, meta ? JSON.stringify(meta) : "");
    } else {
      console.error(JSON.stringify({ level: "error", time: new Date().toISOString(), message: msg, ...meta }));
    }
  },
};

// 9. Prisma Client Setup with Conditional Dev Query Logging & Connection Pooling
const prisma = new PrismaClient({
  log: IS_DEV ? ["query", "info", "warn", "error"] : ["error"],
});

const app = express();
const server = http.createServer(app);

// Memory cache for DB activity throttling to prevent DB write lock contention
const activityThrottleMap = new Map<string, number>();

function getAllowedOrigins(): string[] {
  const defaultOrigins = IS_DEV ? ["http://localhost:3000", "http://127.0.0.1:3000"] : [];
  const envOrigins: string[] = [];

  if (env.FRONTEND_ORIGIN) {
    env.FRONTEND_ORIGIN.split(",").forEach((origin) => {
      const trimmed = origin.trim().replace(/\/$/, "");
      if (trimmed && trimmed !== "*") {
        envOrigins.push(trimmed);
      }
    });
  }

  Object.keys(process.env).forEach((key) => {
    if (key.startsWith("FRONTEND_ORIGIN_")) {
      const val = process.env[key]?.trim().replace(/\/$/, "");
      if (val && val !== "*") {
        envOrigins.push(val);
      }
    }
  });

  return Array.from(new Set([...defaultOrigins, ...envOrigins]));
}

function checkCorsOrigin(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
  if (!origin) {
    return callback(null, true);
  }

  const normalizedOrigin = origin.replace(/\/$/, "");
  const allowed = getAllowedOrigins();
  if (allowed.includes(normalizedOrigin)) {
    return callback(null, true);
  }

  if (IS_DEV) {
    try {
      const url = new URL(normalizedOrigin);
      const hostname = url.hostname;
      if (
        hostname === "localhost" ||
        hostname === "127.0.0.1" ||
        /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
        /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
      ) {
        return callback(null, true);
      }
    } catch {
      // Invalid URL format
    }
  }

  callback(new Error(`CORS policy: Origin ${origin} is not allowed.`));
}

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      checkCorsOrigin(origin, (err, allow) => {
        if (err || !allow) {
          callback(err ?? new Error("Not allowed by CORS"), false);
        } else {
          callback(null, true);
        }
      });
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

app.set("trust proxy", 1);

// 17. Request ID Tracing Middleware
app.use((req, res, next) => {
  const reqId = (req.headers["x-request-id"] as string) || crypto.randomUUID();
  res.setHeader("X-Request-ID", reqId);
  (req as express.Request & { requestId: string }).requestId = reqId;
  next();
});

// 6. Request Timeout Middleware (15s timeout for REST endpoints)
app.use((req, res, next) => {
  req.setTimeout(15000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout." });
    }
  });
  next();
});

// 2. HTTP Compression Middleware
app.use(compression());

// 1. & 11. Helmet Security Headers Setup
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    noSniff: true,
    xssFilter: true,
  }),
);

app.use(express.json({ limit: "32kb" }));

if (IS_DEV) {
  app.use(morgan("dev"));
} else {
  app.use(morgan("combined"));
}

app.use(
  cors({
    origin: (origin, callback) => {
      checkCorsOrigin(origin, callback);
    },
    credentials: true,
  }),
);

// 9. Rate Limiting Configurations
const globalLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const sessionCreationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Session creation limit exceeded. Please wait a minute." },
});

const pairingLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Pairing attempt limit exceeded. Please try again shortly." },
});

app.use(globalLimiter);

// 5. Zod Request Validation Schemas
const connectSchema = z.object({
  sessionId: z.string().regex(/^[A-Z0-9]{6}$/),
  deviceName: z.string().min(1).max(80),
  token: z.string().min(20),
});

const disconnectSchema = z.object({
  sessionId: z.string().regex(/^[A-Z0-9]{6}$/),
  token: z.string().min(20),
});

const signalSchema = z.object({ payload: z.record(z.string(), z.unknown()) });

function getIceServers(): IceServer[] {
  const servers: IceServer[] = [
    { urls: env.STUN_URL },
  ];

  if (env.TURN_URL && env.TURN_USERNAME && env.TURN_CREDENTIAL) {
    servers.push({
      urls: env.TURN_URL,
      username: env.TURN_USERNAME,
      credential: env.TURN_CREDENTIAL,
    });
  }

  return servers;
}

function signToken(sessionId: string, role: Role, secret: string) {
  return jwt.sign({ sessionId, role, secret }, JWT_SECRET, {
    expiresIn: env.SESSION_TTL_SECONDS,
    issuer: "mirrorconnect",
    audience: "mirrorconnect-signaling",
  });
}

function verifyToken(token: string, sessionId: string, role?: Role) {
  const payload = jwt.verify(token, JWT_SECRET, {
    issuer: "mirrorconnect",
    audience: "mirrorconnect-signaling",
  }) as jwt.JwtPayload & { sessionId: string; role: Role; secret: string };

  if (payload.sessionId !== sessionId || (role && payload.role !== role)) {
    throw new Error("Token does not match this session.");
  }

  return payload;
}

async function verifySessionToken(sessionId: string, token: string, role?: Role) {
  const payload = verifyToken(token, sessionId, role);
  const session = await prisma.mirrorSession.findUnique({ where: { sessionId } });

  if (!session || session.status === "expired" || session.expiresAt <= new Date()) {
    throw new Error("Session is expired or unavailable.");
  }

  const ok = await bcrypt.compare(payload.secret, session.tokenHash);
  if (!ok) {
    throw new Error("Invalid session token.");
  }

  return { payload, session };
}

function makeSessionId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
}

async function createUniqueSessionId() {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const sessionId = makeSessionId();
    const existing = await prisma.mirrorSession.findUnique({ where: { sessionId } });
    if (!existing) {
      return sessionId;
    }
  }

  throw new Error("Could not allocate a unique session.");
}

// Optimized DB write throttling (max 1 update per 10s per session)
async function markActivity(sessionId: string) {
  const now = Date.now();
  const lastUpdated = activityThrottleMap.get(sessionId) ?? 0;
  if (now - lastUpdated < 10_000) {
    return;
  }
  activityThrottleMap.set(sessionId, now);

  try {
    await prisma.mirrorSession.updateMany({
      where: { sessionId, status: { not: "expired" } },
      data: { lastActivityAt: new Date() },
    });
  } catch (err) {
    logger.warn("Failed to update activity timestamp", { sessionId, error: err instanceof Error ? err.message : String(err) });
  }
}

async function expireSession(sessionId: string, reason: string) {
  try {
    const updated = await prisma.mirrorSession.updateMany({
      where: { sessionId, status: { not: "expired" } },
      data: { status: "expired", viewerSocketId: null, deviceSocketId: null },
    });

    activityThrottleMap.delete(sessionId);

    if (updated.count) {
      io.to(sessionId).emit("expired", { reason });
      io.in(sessionId).disconnectSockets(true);
    }
  } catch (err) {
    logger.error("Error expiring session", { sessionId, error: err instanceof Error ? err.message : String(err) });
  }
}

async function setStatus(sessionId: string, status: SessionStatus, detail?: Prisma.InputJsonValue) {
  try {
    await prisma.mirrorSession.update({
      where: { sessionId },
      data: {
        status,
        lastActivityAt: new Date(),
        events: {
          create: {
            type: status,
            detail,
          },
        },
      },
    });
    io.to(sessionId).emit("status", { status, detail });
  } catch (err) {
    logger.error("Error setting session status", { sessionId, status, error: err instanceof Error ? err.message : String(err) });
  }
}

// 15. Health & Diagnostic Endpoints with Database Connectivity Check
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const memory = process.memoryUsage();
    res.json({
      status: "ok",
      service: "mirrorconnect-backend",
      database: "connected",
      uptimeSeconds: Math.floor(process.uptime()),
      connectedSockets: io.engine.clientsCount,
      memory: {
        rssMb: Math.round(memory.rss / (1024 * 1024)),
        heapTotalMb: Math.round(memory.heapTotal / (1024 * 1024)),
        heapUsedMb: Math.round(memory.heapUsed / (1024 * 1024)),
      },
    });
  } catch (error) {
    logger.error("Health check database failure", { error: error instanceof Error ? error.message : String(error) });
    res.status(503).json({
      status: "error",
      service: "mirrorconnect-backend",
      database: "disconnected",
      error: error instanceof Error ? error.message : "Database unavailable",
    });
  }
});

app.get("/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ready: true, service: "mirrorconnect-backend" });
  } catch {
    res.status(503).json({ ready: false, service: "mirrorconnect-backend" });
  }
});

app.get("/version", (_req, res) => {
  res.json({
    name: "@mirrorconnect/backend",
    version: "1.0.0",
    nodeEnv: env.NODE_ENV,
    nodeVersion: process.version,
  });
});

app.post("/api/session", sessionCreationLimiter, async (_req, res, next) => {
  try {
    const sessionId = await createUniqueSessionId();
    const secret = crypto.randomBytes(32).toString("hex");
    const tokenHash = await bcrypt.hash(secret, 12);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const token = signToken(sessionId, "viewer", secret);
    const connectUrl = `${PUBLIC_APP_URL.replace(/\/$/, "")}/connect/${sessionId}?token=${encodeURIComponent(token)}`;
    const qrDataUrl = await QRCode.toDataURL(connectUrl, {
      margin: 1,
      width: 480,
      color: { dark: "#111827", light: "#ffffff" },
    });

    await prisma.mirrorSession.create({
      data: {
        sessionId,
        tokenHash,
        expiresAt,
        events: { create: { type: "created" } },
      },
    });

    logger.info("Session created", { sessionId, expiresAt: expiresAt.toISOString() });
    res.status(201).json({ sessionId, token, connectUrl, qrDataUrl, expiresAt: expiresAt.toISOString(), iceServers: getIceServers() });
  } catch (error) {
    next(error);
  }
});

app.get("/api/session/:id", async (req, res, next) => {
  try {
    const id = String(req.params.id ?? "").toUpperCase();
    if (!isSessionId(id)) {
      res.status(400).json({ error: "Invalid session id." });
      return;
    }

    const session = await prisma.mirrorSession.findUnique({ where: { sessionId: id } });
    if (!session || session.expiresAt <= new Date() || session.status === "expired") {
      if (session) {
        await expireSession(id, "Session expired.");
      }
      res.status(404).json({ error: "Session not found or expired." });
      return;
    }

    res.json({
      sessionId: session.sessionId,
      status: session.status,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      iceServers: getIceServers(),
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/connect", pairingLimiter, async (req, res, next) => {
  try {
    const body = connectSchema.parse(req.body);
    const deviceName = sanitizeDeviceName(body.deviceName);
    const { payload, session } = await verifySessionToken(body.sessionId, body.token, "viewer");

    if (session.deviceSocketId || session.status === "connected") {
      res.status(409).json({ error: "This QR session already has a device." });
      return;
    }

    const deviceToken = signToken(body.sessionId, "device", payload.secret);
    await prisma.mirrorSession.update({
      where: { sessionId: body.sessionId },
      data: {
        deviceName,
        status: "connecting",
        lastActivityAt: new Date(),
        events: { create: { type: "device-authorized", detail: { deviceName } } },
      },
    });
    io.to(body.sessionId).emit("device-authorized", { deviceName });

    logger.info("Device paired with session", { sessionId: body.sessionId, deviceName });
    res.json({ token: deviceToken, sessionId: body.sessionId, deviceName, iceServers: getIceServers() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/disconnect", async (req, res, next) => {
  try {
    const body = disconnectSchema.parse(req.body);
    await verifySessionToken(body.sessionId, body.token);
    await setStatus(body.sessionId, "disconnected", { reason: "Manual disconnect" });
    io.to(body.sessionId).emit("disconnect-session", { reason: "Manual disconnect" });
    logger.info("Session disconnected manually", { sessionId: body.sessionId });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Socket.IO Signaling Authentication
io.use(async (socket, next) => {
  try {
    const auth = socket.handshake.auth as SocketAuth;
    if (!auth || !isSessionId(auth.sessionId) || !auth.token || !["viewer", "device"].includes(auth.role)) {
      throw new Error("Invalid socket authentication.");
    }

    await verifySessionToken(auth.sessionId, auth.token, auth.role);
    socket.data.sessionId = auth.sessionId;
    socket.data.role = auth.role;
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized.";
    next(error instanceof Error ? error : new Error("Unauthorized."));
  }
});

function forwardSignal(socket: Socket, event: "offer" | "answer" | "ice-candidate") {
  socket.on(event, (message: unknown) => {
    void (async () => {
      const parsed = signalSchema.safeParse(message);
      if (!parsed.success) {
        socket.emit("signal-error", { event, error: "Invalid signaling payload." });
        return;
      }
      const sessionId = socket.data.sessionId as string;
      const role = socket.data.role as Role;
      await markActivity(sessionId);

      const type = event === "ice-candidate" ? `${event}-${role}` : event;
      if (event !== "ice-candidate" || !await prisma.sessionEvent.findFirst({ where: { sessionId, type } })) {
        await prisma.sessionEvent.create({ data: { sessionId, type, detail: { role } } });
      }
      socket.to(sessionId).emit(event, { from: role, payload: parsed.data.payload });
    })().catch(() => socket.emit("signal-error", { event, error: "Could not forward signaling data." }));
  });
}

io.on("connection", async (socket) => {
  const sessionId = socket.data.sessionId as string;
  const role = socket.data.role as Role;
  socket.join(sessionId);

  try {
    const session = await prisma.mirrorSession.update({
      where: { sessionId },
      data: role === "viewer" ? { viewerSocketId: socket.id } : { deviceSocketId: socket.id },
    });
    socket.emit("status", { status: session.status });

    if (role === "viewer") {
      socket.emit("create-session", { sessionId });
      socket.to(sessionId).emit("viewer-available");
    } else {
      await setStatus(sessionId, "connecting", { role });
      socket.to(sessionId).emit("join-session", { role });
    }
  } catch (err) {
    logger.error("Error setting socket connection ID", { sessionId, role, error: err instanceof Error ? err.message : String(err) });
  }

  socket.on("share-started", async (detail: { deviceName?: string }) => {
    await setStatus(sessionId, "connecting", { deviceName: detail?.deviceName });
  });

  socket.on("connected", async () => {
    try {
      await prisma.mirrorSession.update({
        where: { sessionId },
        data: { status: "connected", connectedAt: new Date(), lastActivityAt: new Date() },
      });
      io.to(sessionId).emit("status", { status: "connected" });
    } catch (err) {
      logger.error("Error updating connected status", { sessionId, error: err instanceof Error ? err.message : String(err) });
    }
  });

  forwardSignal(socket, "offer");
  forwardSignal(socket, "answer");
  forwardSignal(socket, "ice-candidate");

  socket.on("heartbeat", async () => {
    await markActivity(sessionId);
  });

  socket.on("disconnect-session", async (message: { reason?: string }) => {
    await setStatus(sessionId, "disconnected", { reason: message?.reason ?? "Peer disconnected" });
    socket.to(sessionId).emit("disconnect-session", { reason: message?.reason ?? "Peer disconnected" });
  });

  socket.on("disconnect", async () => {
    try {
      const session = await prisma.mirrorSession.findUnique({ where: { sessionId } });
      if (!session || session.status === "expired") {
        return;
      }

      await prisma.mirrorSession.update({
        where: { sessionId },
        data: role === "viewer" ? { viewerSocketId: null } : { deviceSocketId: null },
      });
      socket.to(sessionId).emit("peer-disconnected", { role });
    } catch (err) {
      logger.error("Error updating disconnect state", { sessionId, role, error: err instanceof Error ? err.message : String(err) });
    }
  });
});

// Resilient background interval tick (wrapped in try/catch error boundary)
const cleanupInterval = setInterval(async () => {
  try {
    const now = new Date();
    const inactiveBefore = new Date(Date.now() - INACTIVITY_MS);
    const sessions = await prisma.mirrorSession.findMany({
      where: {
        status: { not: "expired" },
        OR: [{ expiresAt: { lte: now } }, { lastActivityAt: { lte: inactiveBefore } }],
      },
      select: { sessionId: true, expiresAt: true, lastActivityAt: true },
      take: 100,
    });

    await Promise.all(
      sessions.map((session) =>
        expireSession(
          session.sessionId,
          session.expiresAt <= now ? "QR session expired." : "Disconnected after inactivity.",
        ),
      ),
    );
  } catch (err) {
    logger.error("Background session cleanup error", { error: err instanceof Error ? err.message : String(err) });
  }
}, 15_000);

// 4. Global Express Error Handling Middleware
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const reqId = (req as express.Request & { requestId?: string }).requestId;
  const isZod = error instanceof z.ZodError;
  const message = isZod
    ? "Input validation failed."
    : error instanceof Error
      ? error.message
      : "Unexpected server error.";
  const status = isZod ? 400 : message.includes("token") || message.includes("Unauthorized") ? 401 : 500;

  logger.error("Express request error", {
    requestId: reqId,
    path: req.path,
    method: req.method,
    status,
    error: message,
    zodDetails: isZod ? (error as z.ZodError).format() : undefined,
  });

  res.status(status).json({
    error: message,
    requestId: reqId,
    ...(isZod ? { details: (error as z.ZodError).format() } : {}),
  });
});

// 7. Database Connection Retry Logic (Non-blocking background connection)
async function connectDatabaseWithRetry(maxRetries = 5, delayMs = 2000) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      logger.info("Database connection established successfully.");
      return;
    } catch (err) {
      logger.error(`Database connection attempt ${attempt}/${maxRetries} failed:`, { error: err instanceof Error ? err.message : String(err) });
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  logger.warn("Could not establish initial database connection after max retries. Retrying on demand.");
}

// 3. Graceful Shutdown Handlers (SIGTERM / SIGINT)
async function shutdown(signal: string) {
  logger.info(`Received ${signal}. Initiating graceful shutdown...`);
  clearInterval(cleanupInterval);

  io.close(() => {
    logger.info("Socket.IO server closed.");
  });

  server.close(async () => {
    logger.info("HTTP server closed.");
    try {
      await prisma.$disconnect();
      logger.info("Prisma database connection closed cleanly.");
      process.exit(0);
    } catch (err) {
      logger.error("Error disconnecting Prisma during shutdown:", { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error("Shutdown timed out. Forcing process exit.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Start server immediately on 0.0.0.0 to satisfy Render health check port binding
server.listen(PORT, "0.0.0.0", () => {
  logger.info(`MirrorConnect production signaling server listening on 0.0.0.0:${PORT}`, { port: PORT, env: env.NODE_ENV });
  void connectDatabaseWithRetry();
});
