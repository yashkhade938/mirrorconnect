# MirrorConnect Security Architecture & Hardening Manual

This document details the security posture, authentication protocols, rate limiting, and infrastructure hardening implemented in MirrorConnect.

---

## 1. Security Architecture Controls

### Strict CORS Policy (No Wildcards)
- Server explicitly checks allowed origin against `FRONTEND_ORIGIN` and `FRONTEND_ORIGIN_x` environment variables.
- `origin: "*"` is prohibited in both Express and Socket.IO middleware.

### JWT Cryptographic Pairing
- QR session pairing uses JWT tokens signed with SHA-256 HMAC (`JWT_SECRET`).
- Tokens include claims for `sessionId`, `role` (`viewer` or `device`), `issuer` (`mirrorconnect`), and `audience` (`mirrorconnect-signaling`).
- Token payload secrets are verified against bcrypt salted hashes stored in PostgreSQL (`tokenHash`).

### Helmet & Nginx Security Headers
- `Strict-Transport-Security`: `max-age=63072000; includeSubDomains; preload`
- `X-Frame-Options`: `SAMEORIGIN`
- `X-Content-Type-Options`: `nosniff`
- `Referrer-Policy`: `strict-origin-when-cross-origin`
- `Permissions-Policy`: `camera=(), microphone=(), display-capture=(self)`

### Rate Limiting
- `express-rate-limit` enforces 120 requests/minute per IP across HTTP endpoints to mitigate brute-force and denial-of-service attacks.

### Single Device Enforcement
- Each QR session permits exactly one paired device. Subsequent pairing attempts return HTTP 409 Conflict.

### Log Sanitation
- Sensitive secrets, JWT tokens, and password hashes are never logged. Diagnostic logs (`logDev`) run strictly when `NODE_ENV !== "production"`.

---

## 2. Hardening Checklist for Production

- [x] HTTPS enforced with Let's Encrypt TLS 1.2/1.3.
- [x] UFW firewall restricts exposed ports to 22, 80, 443, 3478/UDP, 5349/UDP.
- [x] Docker containers run as non-root user where applicable.
- [x] Coturn TURN server uses custom realm and non-default credentials.
- [x] Database password rotated and isolated from repository source code.
