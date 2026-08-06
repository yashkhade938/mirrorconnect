# MirrorConnect

MirrorConnect is a production-ready QR-paired Android browser screen mirroring app. A PC opens the dashboard, receives a five-minute one-session QR code, and an Android browser scans it to share the screen over WebRTC with Socket.IO signaling.

## Stack

- Frontend: Next.js 16.3.0 App Router, TypeScript, Tailwind CSS
- Backend: Node.js, Express, Socket.IO
- Streaming: WebRTC with STUN and optional TURN
- QR: `qrcode`
- Database: PostgreSQL with Prisma
- Security: JWT session tokens, rate limiting, Helmet, CORS, input validation
- Free Deployment: Vercel + Render/Railway + Neon Serverless PostgreSQL

## Features

- One QR code per session with automatic five-minute refresh
- Session-scoped JWT pairing and one-device enforcement
- WebRTC offer, answer, and ICE candidate exchange
- Reconnect-capable Socket.IO signaling
- Status states: Waiting, Connecting, Connected, Disconnected, Expired
- Bitrate, FPS, resolution, and latency display
- Fullscreen, screenshot, and stream recording
- Dark mode and responsive phone/desktop views
- Inactivity expiry for abandoned sessions
- STUN/TURN environment configuration

## Free Cloud Deployment (No VPS Required)

MirrorConnect can be deployed 100% free using serverless cloud platforms:

- **Frontend**: Deploy to **Vercel Free** (`vercel.json`)
- **Backend**: Deploy to **Render Free** (`render.yaml`) or **Railway Free** (`railway.json`)
- **Database**: Deploy to **Neon Free** or **Supabase Free** Serverless PostgreSQL

Detailed step-by-step instructions:
- Architecture Overview: [`DEPLOY_FREE.md`](file:///c:/Users/Yash%20Khade/Documents/New%20Project_1/DEPLOY_FREE.md)
- Step-by-Step Walkthrough Guide: [`FREE_DEPLOYMENT_GUIDE.md`](file:///c:/Users/Yash%20Khade/Documents/New%20Project_1/FREE_DEPLOYMENT_GUIDE.md)

## Local Development

Install dependencies:

```bash
npm install
```

Start PostgreSQL, then configure the backend:

```bash
cp backend/.env.example backend/.env
```

Run migrations:

```bash
npm run migrate:deploy --workspace @mirrorconnect/backend
```

Run backend and frontend in separate terminals:

```bash
npm run dev:backend
npm run dev:frontend
```

Open `http://localhost:3000`.

## Production Deployment Notes

Use HTTPS in production. Android browser screen capture requires a secure context, except for localhost.

Multiple frontend origins are supported via `FRONTEND_ORIGIN`, `FRONTEND_ORIGIN_2`, `FRONTEND_ORIGIN_3` environment variables.

Rotate `JWT_SECRET` with a long random value and keep database credentials outside source control.

## API & Endpoints

- `GET /health` service health and database telemetry
- `GET /ready` service readiness probe
- `GET /version` backend version probe
- `POST /api/session` creates a unique session and QR payload
- `GET /api/session/:id` returns public session state
- `POST /api/connect` authorizes a scanned phone with the QR JWT
- `POST /api/disconnect` ends a paired session

## Socket Events

- `create-session`
- `join-session`
- `offer`
- `answer`
- `ice-candidate`
- `disconnect-session`
- `expired`

