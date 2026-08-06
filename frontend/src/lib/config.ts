export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? API_URL;

export function requireSecureContext() {
  if (typeof window === "undefined") {
    return true;
  }

  return window.isSecureContext || window.location.hostname === "localhost";
}
