# MirrorConnect Free Deployment Guide (`FREE_DEPLOYMENT_GUIDE.md`)

Step-by-step manual to deploy MirrorConnect completely free using **Neon PostgreSQL**, **Render / Railway**, and **Vercel**.

---

## Step 1: Create Neon Serverless PostgreSQL Database

1. Sign up at [https://neon.tech](https://neon.tech) (Free Tier).
2. Click **Create Project**, name it `mirrorconnect`, and select your nearest region.
3. Copy the provided connection string:
   ```text
   postgresql://alex:password123@ep-sample-123456.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Save this string as your `DATABASE_URL`.

---

## Step 2: Deploy Backend to Render (or Railway)

### Option A: Render Free Web Service (Recommended)

1. Sign up at [https://render.com](https://render.com) (Free Tier).
2. Click **New +** -> **Web Service**.
3. Connect your GitHub repository containing the MirrorConnect codebase.
4. Configure service settings:
   - **Name**: `mirrorconnect-backend`
   - **Environment**: `Node`
   - **Region**: Same region as Neon database
   - **Branch**: `main`
   - **Root Directory**: Leave blank (monorepo root)
   - **Build Command**:
     ```bash
     npm run build --workspace @mirrorconnect/shared && npm run build --workspace @mirrorconnect/backend
     ```
   - **Start Command**:
     ```bash
     cd backend && npx prisma migrate deploy && node dist/server.js
     ```
5. Add Environment Variables in Render Dashboard:
   - `NODE_ENV` = `production`
   - `PORT` = `4000`
   - `DATABASE_URL` = `YOUR_NEON_DATABASE_URL`
   - `JWT_SECRET` = `generate-a-secure-random-secret-key`
   - `SESSION_TTL_SECONDS` = `300`
   - `INACTIVITY_TIMEOUT_SECONDS` = `120`
   - `PUBLIC_APP_URL` = `https://your-app-name.vercel.app`
   - `FRONTEND_ORIGIN` = `https://your-app-name.vercel.app`
   - `STUN_URL` = `stun:stun.l.google.com:19302`
6. Click **Create Web Service**. Note your backend URL (e.g. `https://mirrorconnect-backend.onrender.com`).

---

## Step 3: Deploy Frontend to Vercel

1. Sign up at [https://vercel.com](https://vercel.com) (Free Tier).
2. Click **Add New...** -> **Project**.
3. Import your MirrorConnect GitHub repository.
4. Configure build settings:
   - **Framework Preset**: Next.js
   - **Root Directory**: `./`
   - **Build Command**:
     ```bash
     npm run build --workspace @mirrorconnect/shared && npm run build --workspace @mirrorconnect/frontend
     ```
   - **Output Directory**: `frontend/.next`
5. Add Environment Variables in Vercel Dashboard:
   - `NEXT_PUBLIC_API_URL` = `https://mirrorconnect-backend.onrender.com`
   - `NEXT_PUBLIC_SOCKET_URL` = `https://mirrorconnect-backend.onrender.com`
   - `NEXT_PUBLIC_APP_URL` = `https://your-app-name.vercel.app`
6. Click **Deploy**. Note your frontend URL (e.g. `https://mirrorconnect.vercel.app`).

---

## Step 4: Synchronize CORS & Allowed Origins

1. Return to your Render / Railway backend dashboard.
2. Ensure `PUBLIC_APP_URL` and `FRONTEND_ORIGIN` are updated to match your exact Vercel URL:
   - `PUBLIC_APP_URL` = `https://mirrorconnect.vercel.app`
   - `FRONTEND_ORIGIN` = `https://mirrorconnect.vercel.app`
3. Trigger a redeploy on Render / Railway.

---

## Step 5: Verification & End-to-End Testing

Execute the following 10-step verification checklist:

1. **Verify Database**: Check Neon dashboard -> Tables -> `MirrorSession` table created cleanly.
2. **Verify Backend Health**: Visit `https://mirrorconnect-backend.onrender.com/health` -> JSON response: `{ "status": "ok", "database": "connected" }`.
3. **Verify Ready Probe**: Visit `https://mirrorconnect-backend.onrender.com/ready` -> `{ "ready": true }`.
4. **Verify Version Endpoint**: Visit `https://mirrorconnect-backend.onrender.com/version` -> `{ "name": "@mirrorconnect/backend", "version": "1.0.0" }`.
5. **Verify Frontend**: Open `https://mirrorconnect.vercel.app` in Chrome/Firefox.
6. **Verify Session & QR**: Click **Generate Session** -> QR Code renders with valid production URL payload (`https://mirrorconnect.vercel.app/connect/XXXXXX?token=...`).
7. **Verify Socket.IO Handshake**: Open browser DevTools Network tab -> `WS` / `socket.io` connection established with `HTTP 101 Switching Protocols`.
8. **Verify Android Pairing**: Scan QR code with Android device -> Phone opens `/connect/XXXXXX`.
9. **Verify Screen Share**: Tap **Connect & Share Screen** on phone -> Select screen -> Grant media permission.
10. **Verify Live Stream & Recording**: Phone screen appears live on PC dashboard. Test **Record** and **Screenshot** features.
