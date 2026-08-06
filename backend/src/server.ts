import "dotenv/config";
import crypto from "node:crypto";
import http from "node:http";
import bcrypt from "bcryptjs";
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

const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);

const PORT = Number(process.env.PORT ?? 4000);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_SECONDS ?? 300) * 1000;
const INACTIVITY_MS = Number(process.env.INACTIVITY_TIMEOUT_SECONDS ?? 120) * 1000;
const JWT_SECRET = process.env.JWT_SECRET ?? "replace-this-secret-in-production";
const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";

const IS_DEV = process.env.NODE_ENV !== "production";

function logDev(...args: unknown[]) {
  if (IS_DEV) {
    console.log("[Socket.IO Dev]", ...args);
  }
}

function getAllowedOrigins(): string[] {
  const defaultOrigins = IS_DEV ? ["http://localhost:3000", "http://127.0.0.1:3000"] : [];
  const envOrigins: string[] = [];

  if (process.env.FRONTEND_ORIGIN) {
    process.env.FRONTEND_ORIGIN.split(",").forEach((origin) => {
      const trimmed = origin.trim();
      if (trimmed && trimmed !== "*") {
        envOrigins.push(trimmed);
      }
    });
  }

  Object.keys(process.env).forEach((key) => {
    if (key.startsWith("FRONTEND_ORIGIN_")) {
      const val = process.env[key]?.trim();
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

  const allowed = getAllowedOrigins();
  if (allowed.includes(origin)) {
    return callback(null, true);
  }

  if (IS_DEV) {
    try {
      const url = new URL(origin);
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
      // Invalid URL string
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
app.use(express.json({ limit: "32kb" }));
app.use(morgan("combined"));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);
app.use(
  cors({
    origin: (origin, callback) => {
      checkCorsOrigin(origin, callback);
    },
    credentials: true,
  }),
);
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);

const connectSchema = z.object({
  sessionId: z.string().regex(/^[A-Z0-9]{6}$/),
  deviceName: z.string().min(1).max(80),
  token: z.string().min(20),
});
const signalSchema = z.object({ payload: z.record(z.string(), z.unknown()) });

function getIceServers(): IceServer[] {
  const servers: IceServer[] = [
    { urls: process.env.STUN_URL ?? "stun:stun.l.google.com:19302" },
  ];

  if (process.env.TURN_URL && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_CREDENTIAL,
    });
  }

  return servers;
}

function signToken(sessionId: string, role: Role, secret: string) {
  return jwt.sign({ sessionId, role, secret }, JWT_SECRET, {
    expiresIn: Math.ceil(SESSION_TTL_MS / 1000),
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

async function markActivity(sessionId: string) {
  await prisma.mirrorSession.updateMany({
    where: { sessionId, status: { not: "expired" } },
    data: { lastActivityAt: new Date() },
  });
}

async function expireSession(sessionId: string, reason: string) {
  const updated = await prisma.mirrorSession.updateMany({
    where: { sessionId, status: { not: "expired" } },
    data: { status: "expired", viewerSocketId: null, deviceSocketId: null },
  });

  if (updated.count) {
    io.to(sessionId).emit("expired", { reason });
    io.in(sessionId).disconnectSockets(true);
  }
}

async function setStatus(sessionId: string, status: SessionStatus, detail?: Prisma.InputJsonValue) {
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
}

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
    nodeEnv: process.env.NODE_ENV ?? "development",
    nodeVersion: process.version,
  });
});

app.post("/api/session", async (_req, res, next) => {
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

    res.status(201).json({ sessionId, token, connectUrl, qrDataUrl, expiresAt, iceServers: getIceServers() });
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

app.post("/api/connect", async (req, res, next) => {
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

    res.json({ token: deviceToken, sessionId: body.sessionId, deviceName, iceServers: getIceServers() });
  } catch (error) {
    next(error);
  }
});

app.post("/api/disconnect", async (req, res, next) => {
  try {
    const sessionId = String(req.body?.sessionId ?? "").toUpperCase();
    const token = String(req.body?.token ?? "");
    if (!isSessionId(sessionId) || !token) {
      res.status(400).json({ error: "Invalid disconnect request." });
      return;
    }

    await verifySessionToken(sessionId, token);
    await setStatus(sessionId, "disconnected", { reason: "Manual disconnect" });
    io.to(sessionId).emit("disconnect-session", { reason: "Manual disconnect" });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

io.use(async (socket, next) => {
  try {
    const auth = socket.handshake.auth as SocketAuth;
    logDev(`Auth attempt from ${socket.id} (IP: ${socket.handshake.address}, transport: ${socket.conn.transport.name})`, {
      sessionId: auth?.sessionId,
      role: auth?.role,
      tokenProvided: Boolean(auth?.token),
    });

    if (!auth || !isSessionId(auth.sessionId) || !auth.token || !["viewer", "device"].includes(auth.role)) {
      logDev(`Auth failed for ${socket.id}: Invalid auth payload`);
      throw new Error("Invalid socket authentication.");
    }

    await verifySessionToken(auth.sessionId, auth.token, auth.role);
    socket.data.sessionId = auth.sessionId;
    socket.data.role = auth.role;
    logDev(`Auth success for ${socket.id}: role=${auth.role}, sessionId=${auth.sessionId}`);
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized.";
    logDev(`Auth rejected for ${socket.id}: ${message}`);
    next(error instanceof Error ? error : new Error("Unauthorized."));
  }
});

function forwardSignal(socket: Socket, event: "offer" | "answer" | "ice-candidate") {
  socket.on(event, (message: unknown) => {
    void (async () => {
      const parsed = signalSchema.safeParse(message);
      if (!parsed.success) {
        logDev(`Signal error [${event}] from ${socket.id}: Invalid payload`);
        socket.emit("signal-error", { event, error: "Invalid signaling payload." });
        return;
      }
      const sessionId = socket.data.sessionId as string;
      const role = socket.data.role as Role;
      logDev(`Signal forwarded [${event}] from ${role} (${socket.id}) in session ${sessionId}`);
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
  logDev(`Client connected: ${socket.id} (role: ${role}, session: ${sessionId}, transport: ${socket.conn.transport.name})`);
  socket.join(sessionId);

  socket.conn.on("upgrade", (transport) => {
    logDev(`Transport upgraded for ${socket.id}: ${transport.name}`);
  });

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

  socket.on("share-started", async (detail: { deviceName?: string }) => {
    await setStatus(sessionId, "connecting", { deviceName: detail?.deviceName });
  });

  socket.on("connected", async () => {
    await prisma.mirrorSession.update({
      where: { sessionId },
      data: { status: "connected", connectedAt: new Date(), lastActivityAt: new Date() },
    });
    io.to(sessionId).emit("status", { status: "connected" });
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
    const session = await prisma.mirrorSession.findUnique({ where: { sessionId } });
    if (!session || session.status === "expired") {
      return;
    }

    await prisma.mirrorSession.update({
      where: { sessionId },
      data: role === "viewer" ? { viewerSocketId: null } : { deviceSocketId: null },
    });
    socket.to(sessionId).emit("peer-disconnected", { role });
  });
});

setInterval(async () => {
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
}, 15_000);

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof z.ZodError
    ? "Input validation failed."
    : error instanceof Error
      ? error.message
      : "Unexpected server error.";
  const status = error instanceof z.ZodError ? 400 : message.includes("token") || message.includes("Unauthorized") ? 401 : 500;
  res.status(status).json({ error: message });
});

server.listen(PORT, () => {
  console.log(`MirrorConnect signaling server listening on ${PORT}`);
});
