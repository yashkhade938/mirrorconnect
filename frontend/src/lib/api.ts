import type { PublicSession, SessionPayload } from "@mirrorconnect/shared";
import { API_URL } from "./config";

async function parseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error ?? "Request failed.");
  }
  return payload as T;
}

export async function createSession() {
  const response = await fetch(`${API_URL}/api/session`, { method: "POST" });
  return parseJson<SessionPayload>(response);
}

export async function getSession(sessionId: string) {
  const response = await fetch(`${API_URL}/api/session/${encodeURIComponent(sessionId)}`);
  return parseJson<PublicSession & { iceServers: RTCIceServer[] }>(response);
}

export async function connectDevice(sessionId: string, token: string, deviceName: string) {
  const response = await fetch(`${API_URL}/api/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, token, deviceName }),
  });
  return parseJson<{ token: string; sessionId: string; deviceName: string; iceServers: RTCIceServer[] }>(response);
}

export async function disconnectSession(sessionId: string, token: string) {
  const response = await fetch(`${API_URL}/api/disconnect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, token }),
  });
  return parseJson<{ ok: true }>(response);
}
