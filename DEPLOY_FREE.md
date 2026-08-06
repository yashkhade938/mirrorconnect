# MirrorConnect Free Cloud Tier Architecture (`DEPLOY_FREE.md`)

## 1. Overview & Free Stack Topology

MirrorConnect is adapted to run 100% free without VPS costs, Docker requirements, Nginx proxies, or paid software.

```
       [ Android Phone ]                     [ Desktop Browser ]
         (WebRTC Peer)                          (WebRTC Peer)
               \                                     /
                \                                   /
                 v                                 v
          +-----------------------------------------------+
          |          Vercel Free Frontend SPA            |
          |       https://mirrorconnect.vercel.app        |
          +-----------------------------------------------+
                 |                                 |
                 | HTTPS / REST API                | WebSockets / Socket.IO
                 v                                 v
          +-----------------------------------------------+
          |    Render / Railway Free Backend Service      |
          |  https://mirrorconnect-backend.onrender.com   |
          +-----------------------------------------------+
                                 |
                                 | SSL / TLS Connection
                                 v
          +-----------------------------------------------+
          |      Neon / Supabase Serverless PostgreSQL    |
          |               (Free 512MB DB)                 |
          +-----------------------------------------------+
```

---

## 2. Component Specifications

### 1. Frontend (Vercel Free)
- **Framework**: Next.js 16 (App Router)
- **Deployment**: Automatic Git integration via Vercel
- **Build Output**: `.next` static & edge optimized bundle
- **Environment Bindings**:
  - `NEXT_PUBLIC_API_URL`: Backend API URL on Render/Railway
  - `NEXT_PUBLIC_SOCKET_URL`: Socket.IO Server URL on Render/Railway

### 2. Backend (Render Free / Railway Free)
- **Runtime**: Node.js 20+ Express Engine
- **WebSockets**: Socket.IO with WebSocket + HTTP Polling Fallback
- **Build Command**: `npm run build --workspace @mirrorconnect/shared && npm run build --workspace @mirrorconnect/backend`
- **Start Command**: `cd backend && npx prisma migrate deploy && node dist/server.js`
- **Health Path**: `/health` (integrated telemetry probe)

### 3. Database (Neon Free / Supabase Free)
- **Engine**: PostgreSQL 16 (Serverless)
- **ORM**: Prisma 6.x
- **Connection**: `DATABASE_URL` with `sslmode=require`

### 4. WebRTC Relay Strategy & Known Limitations
- **STUN Relay**: Google Public STUN (`stun:stun.l.google.com:19302`)
- **NAT Traversal**:
  - Works seamlessly across home Wi-Fi networks, 4G/5G mobile data, and standard router configurations.
- **Known Limitations**:
  - Without a dedicated TURN relay (which requires dedicated server bandwidth), P2P media streams may fail on strict symmetric NATs or corporate enterprise firewalls.
