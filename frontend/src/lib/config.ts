export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" &&
  window.location.hostname !== "localhost" &&
  window.location.hostname !== "127.0.0.1"
    ? "https://mirrorconnect-backend.onrender.com"
    : "http://localhost:4000");

export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || API_URL;

export function requireSecureContext() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.isSecureContext || window.location.hostname === "localhost";
}
