export const SESSION_ID_PATTERN = /^[A-Z0-9]{6}$/;

export type Role = "viewer" | "device";

export type SessionStatus = "waiting" | "connecting" | "connected" | "disconnected" | "expired";

export type IceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

export type SessionPayload = {
  sessionId: string;
  token: string;
  connectUrl: string;
  qrDataUrl: string;
  expiresAt: string;
  iceServers: IceServer[];
};

export type PublicSession = {
  sessionId: string;
  status: SessionStatus;
  expiresAt: string;
  createdAt: string;
};

export type ConnectRequest = {
  sessionId: string;
  deviceName: string;
};

export type SocketAuth = {
  sessionId: string;
  token: string;
  role: Role;
};

export type SignalEnvelope<T = unknown> = {
  sessionId: string;
  token: string;
  target?: Role;
  payload: T;
};

export type WebRtcStats = {
  bitrateKbps: number;
  fps: number;
  width: number;
  height: number;
  latencyMs: number;
};

export function isSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

export function sanitizeDeviceName(value: unknown) {
  if (typeof value !== "string") {
    return "Android device";
  }

  const clean = value.replace(/[^\p{L}\p{N}\s._-]/gu, "").replace(/\s+/g, " ").trim();
  return clean.slice(0, 80) || "Android device";
}
