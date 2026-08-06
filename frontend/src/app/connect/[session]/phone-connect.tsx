"use client";

import { useEffect, useRef, useState } from "react";
import { MonitorUp, Plug, Power, Smartphone, WifiOff } from "lucide-react";
import { io, Socket } from "socket.io-client";
import type { SessionStatus } from "@mirrorconnect/shared";
import { connectDevice, disconnectSession, getSession } from "@/lib/api";
import { requireSecureContext, SOCKET_URL } from "@/lib/config";
import { StatusPill } from "@/components/StatusPill";
import { Toast } from "@/components/Toast";

export default function PhoneConnect({ sessionId, initialToken }: { sessionId: string; initialToken: string }) {
  const [deviceName, setDeviceName] = useState("Android Phone");
  const [status, setStatus] = useState<SessionStatus>("waiting");
  const [toast, setToast] = useState("");
  const [connected, setConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [iceServers, setIceServers] = useState<RTCIceServer[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const viewerTokenRef = useRef(initialToken);
  const activeTokenRef = useRef("");
  const heartbeatTimerRef = useRef<number | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const hasConnectedOnceRef = useRef(false);

  useEffect(() => {
    void getSession(sessionId)
      .then((session) => {
        setStatus(session.status);
        setIceServers(session.iceServers);
      })
      .catch((error) => setToast(error instanceof Error ? error.message : "Session is unavailable."));

    return cleanup;
    // The phone page owns one socket/peer lifetime for the scanned session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function connect() {
    if (!viewerTokenRef.current) {
      setToast("This pairing link is missing its secure session token.");
      return;
    }
    if (isConnecting || connected) {
      return;
    }

    setIsConnecting(true);
    const isDev = process.env.NODE_ENV !== "production";
    const logDev = (...args: unknown[]) => {
      if (isDev) {
        console.log("[Phone Socket Dev]", ...args);
      }
    };

    try {
      const response = await connectDevice(sessionId, viewerTokenRef.current, deviceName);
      activeTokenRef.current = response.token;
      setIceServers(response.iceServers);
      clearHeartbeatTimer();
      const socket = io(SOCKET_URL, {
        auth: { sessionId, token: response.token, role: "device" },
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelayMax: 5000,
        autoConnect: false,
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        logDev("Phone socket connected:", socket.id, "Transport:", socket.io.engine.transport.name);
        const reconnected = hasConnectedOnceRef.current;
        hasConnectedOnceRef.current = true;
        setConnected(true);
        setStatus("connecting");

        socket.io.engine.on("upgrade", (transport: { name: string }) => {
          logDev("Transport upgraded:", transport.name);
        });

        if (reconnected && streamRef.current) {
          logDev("Reconnected with active stream, renegotiating...");
          void beginNegotiation();
        }
      });

      socket.on("status", (message: { status: SessionStatus }) => {
        logDev("Session status update:", message.status);
        setStatus(message.status);
      });

      socket.on("answer", async ({ payload: answer }: { payload: RTCSessionDescriptionInit }) => {
        logDev("Received WebRTC answer from viewer");
        const peer = peerRef.current;
        if (!peer) {
          return;
        }
        await peer.setRemoteDescription(answer);
        await flushPendingCandidates(peer);
        setStatus("connected");
      });

      socket.on("ice-candidate", async ({ payload: candidate }: { payload: RTCIceCandidateInit }) => {
        logDev("Received ICE candidate from viewer");
        await addIceCandidate(candidate);
      });

      socket.on("disconnect-session", () => {
        logDev("Session disconnected event");
        setStatus("disconnected");
        cleanupPeer();
      });

      socket.on("expired", (message: { reason: string }) => {
        logDev("Session expired:", message.reason);
        setStatus("expired");
        setToast(message.reason);
        cleanupPeer();
      });

      socket.on("disconnect", (reason) => {
        logDev("Socket disconnected:", reason);
        setConnected(false);
        setStatus("disconnected");
      });

      socket.on("viewer-available", () => {
        logDev("Viewer available event");
        if (streamRef.current) {
          void beginNegotiation();
        }
      });

      socket.on("peer-disconnected", () => {
        logDev("Peer disconnected event");
        setStatus("disconnected");
      });

      socket.on("signal-error", ({ error }: { error: string }) => {
        logDev("Signal error:", error);
        setToast(error);
      });

      socket.on("connect_error", (error: Error & { data?: unknown }) => {
        logDev("Socket connect_error:", error.message, error);
        setConnected(false);
        setToast(`Signaling connection error: ${error.message}`);
      });

      socket.io.on("reconnect_attempt", (attempt: number) => {
        logDev("Reconnection attempt #", attempt);
      });

      socket.io.on("reconnect_failed", () => {
        logDev("Reconnection failed");
        setConnected(false);
        setToast("Failed to reconnect to signaling server.");
      });

      heartbeatTimerRef.current = window.setInterval(() => socket.connected && socket.emit("heartbeat"), 20_000);
      socket.connect();
    } catch (error) {
      setConnected(false);
      setToast(error instanceof Error ? error.message : "Could not connect.");
    } finally {
      setIsConnecting(false);
    }
  }

  async function shareScreen() {
    if (!socketRef.current?.connected) {
      setToast("Connect before sharing the screen.");
      return;
    }

    if (!requireSecureContext()) {
      setToast("Screen sharing requires HTTPS or localhost.");
      return;
    }

    try {
      const stream = shouldUseTestCapture()
        ? createTestPatternStream()
        : await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: { ideal: 30 }, width: { ideal: 1080 } },
            audio: false,
          });
      streamRef.current = stream;
      setSharing(true);
      setStatus("connecting");
      socketRef.current.emit("share-started", { deviceName });

      stream.getVideoTracks()[0]?.addEventListener("ended", () => void disconnect("Screen share stopped."));
      await beginNegotiation();
    } catch (error) {
      setSharing(false);
      setToast(error instanceof Error ? error.message : "Screen sharing was cancelled.");
    }
  }

  async function disconnect(reason = "Disconnected from phone.") {
    cleanupPeer();
    socketRef.current?.emit("disconnect-session", { reason });
    const token = activeTokenRef.current || viewerTokenRef.current;
    if (token) {
      await disconnectSession(sessionId, token).catch(() => undefined);
    }
    setStatus("disconnected");
  }

  function cleanupPeer() {
    closePeer();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setSharing(false);
  }

  function cleanup() {
    cleanupPeer();
    clearHeartbeatTimer();
    socketRef.current?.disconnect();
    socketRef.current = null;
  }

  function closePeer() {
    const peer = peerRef.current;
    peerRef.current = null;
    pendingCandidatesRef.current = [];
    peer?.close();
  }

  async function beginNegotiation() {
    const stream = streamRef.current;
    const socket = socketRef.current;
    if (!stream || !socket?.connected) {
      return;
    }

    closePeer();
    const peer = new RTCPeerConnection({ iceServers });
    peerRef.current = peer;
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      if (event.candidate && peerRef.current === peer) {
        socketRef.current?.emit("ice-candidate", { payload: event.candidate.toJSON() });
      }
    };
    peer.onconnectionstatechange = () => {
      if (peerRef.current !== peer) {
        return;
      }
      if (peer.connectionState === "connected") {
        setStatus("connected");
        socketRef.current?.emit("connected");
      }
      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
        setStatus("disconnected");
      }
    };

    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    if (peerRef.current === peer) {
      socket.emit("offer", { payload: offer });
    }
  }

  async function addIceCandidate(candidate: RTCIceCandidateInit) {
    const peer = peerRef.current;
    if (!peer || !peer.remoteDescription) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    await peer.addIceCandidate(candidate).catch(() => undefined);
  }

  async function flushPendingCandidates(peer: RTCPeerConnection) {
    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    await Promise.all(candidates.map((candidate) => peer.addIceCandidate(candidate).catch(() => undefined)));
  }

  function clearHeartbeatTimer() {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-8 text-white">
      <Toast message={toast} onClose={() => setToast("")} />
      <section className="glass w-full max-w-md rounded-lg p-5">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.35em] text-cyan-200">MirrorConnect</p>
            <h1 className="mt-2 text-2xl font-semibold">Phone pairing</h1>
          </div>
          <StatusPill status={status} />
        </div>

        <div className="mb-5 grid place-items-center rounded-lg border border-white/10 bg-black/20 p-8">
          <Smartphone size={72} className={sharing ? "text-emerald-200" : "text-cyan-200"} />
          <p className="mt-4 font-mono text-lg">{sessionId}</p>
        </div>

        <label className="mb-4 block">
          <span className="mb-2 block text-sm text-zinc-300">Device Name</span>
          <input
            value={deviceName}
            onChange={(event) => setDeviceName(event.target.value)}
            className="w-full rounded-lg border border-white/10 bg-white/10 px-4 py-3 outline-none ring-cyan-300/40 focus:ring-4"
            maxLength={80}
          />
        </label>

        <div className="grid gap-3">
          <button onClick={connect} disabled={connected || isConnecting || status === "expired"} className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 font-semibold text-zinc-950 disabled:opacity-50">
            <Plug size={18} /> Connect
          </button>
          <button onClick={shareScreen} disabled={!connected || sharing || status === "expired"} className="inline-flex items-center justify-center gap-2 rounded-lg border border-cyan-200/30 bg-cyan-300/10 px-4 py-3 font-semibold text-cyan-50 disabled:opacity-50">
            <MonitorUp size={18} /> Share Screen
          </button>
          <button onClick={() => void disconnect()} className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200/30 bg-rose-300/10 px-4 py-3 font-semibold text-rose-50">
            {connected ? <Power size={18} /> : <WifiOff size={18} />} Disconnect
          </button>
        </div>

        <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.05] p-4 text-sm text-zinc-300">
          <p>Connection: {connected ? "Socket connected" : "Not connected"}</p>
          <p>Capture: {sharing ? "Screen stream active" : "Idle"}</p>
          <p>Security: JWT paired session, one device per QR</p>
        </div>
      </section>
    </main>
  );
}

function shouldUseTestCapture() {
  return process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).get("mockCapture") === "1";
}

function createTestPatternStream() {
  const canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas capture is unavailable.");
  }

  let frame = 0;
  let animationFrame = 0;
  const draw = () => {
    frame += 1;
    context.fillStyle = "#0f172a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#22d3ee";
    context.fillRect((frame * 7) % canvas.width, 80, 120, 80);
    context.fillStyle = "#fb7185";
    context.beginPath();
    context.arc(320, 180, 48 + Math.sin(frame / 10) * 20, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "#ffffff";
    context.font = "24px sans-serif";
    context.fillText("MirrorConnect test stream", 28, 322);
    animationFrame = window.requestAnimationFrame(draw);
  };
  const stream = canvas.captureStream(30);
  stream.getVideoTracks()[0]?.addEventListener("ended", () => window.cancelAnimationFrame(animationFrame), { once: true });
  draw();
  return stream;
}
