# MirrorConnect Production Deployment Architecture

This document provides a technical overview of the production container architecture, deployment topology, and environment configuration for MirrorConnect.

---

## 1. Container Topology

```
[ Internet Client (Android Phone / Desktop Browser) ]
                           │
                           ▼ (Port 80 / 443 HTTPS)
                   ┌──────────────┐
                   │  Nginx Proxy │ (TLS 1.2/1.3, HTTP/2, Security Headers)
                   └──────┬───────┘
                          │
         ┌────────────────┴────────────────┐
         ▼                                 ▼
┌──────────────────┐             ┌──────────────────┐
│  Next.js App     │             │ Express Backend  │
│  (Frontend:3000) │             │ (Backend:4000)   │
└──────────────────┘             └────────┬─────────┘
                                          │
                                 ┌────────┴────────┐
                                 ▼                 ▼
                       ┌──────────────────┐ ┌──────────────┐
                       │  PostgreSQL 16   │ │ Coturn TURN  │
                       │  (Database:5432) │ │ (Relay:3478) │
                       └──────────────────┘ └──────────────┘
```

---

## 2. Service Definitions

- **Frontend (`frontend`)**: Next.js 16 App Router SPA listening on port 3000.
- **Backend (`backend`)**: Express Node.js application listening on port 4000 handling REST APIs and Socket.IO signaling.
- **Database (`postgres`)**: PostgreSQL 16 server storing session metadata and event logs.
- **Relay Server (`coturn`)**: Coturn STUN/TURN server providing WebRTC candidate relay across restrictive mobile carrier NATs.
- **Reverse Proxy (`nginx`)**: Nginx server handling SSL termination, static asset caching, and WebSocket proxying.

---

## 3. Deployment Commands

```bash
# Build and start all services in detached mode
docker compose up -d --build

# View container logs
docker compose logs -f

# Run database migrations
docker compose exec backend npm run migrate:deploy

# Restart stack
docker compose restart
```
