"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Copy, Maximize, Moon, RefreshCw, Square, Sun, Video } from "lucide-react";
import Image from "next/image";
import { io, Socket } from "socket.io-client";
import type { SessionPayload, SessionStatus, WebRtcStats } from "@mirrorconnect/shared";
import { createSession, disconnectSession } from "@/lib/api";
import { requireSecureContext, SOCKET_URL } from "@/lib/config";
import { MetricsGrid } from "@/components/MetricsGrid";
import { StatusPill } from "@/components/StatusPill";
import { Toast } from "@/components/Toast";

const emptyStats: WebRtcStats = { bitrateKbps: 0, fps: 0, width: 0, height: 0, latencyMs: 0 };

// React Strict Mode intentionally re-runs effects in development. Keep the
// initial request shared until it settles so that behavior cannot mint two QRs.
let initialSessionRequest: Promise<SessionPayload> | null = null;

export default function Home() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [status, setStatus] = useState<SessionStatus>("waiting");
  const [stats, setStats] = useState<WebRtcStats>(emptyStats);
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(true);
  const [isRecording, setIsRecording] = useState(false);
  const [expiresIn, setExpiresIn] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const lastBytesRef = useRef(0);
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  const expired = useMemo(() => !session || expiresIn <= 0, [expiresIn, session]);

  useEffect(() => {
    document.body.classList.toggle("light-theme", !dark);
  }, [dark]);

  useEffect(() => {
    void refreshSession();
    return cleanup;
    // The initial session owns socket setup and teardown for this page lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!session) {
      return;
    }

    const tick = window.setInterval(() => {
      setExpiresIn(Math.max(0, Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / 1000)));
    }, 1000);

    return () => window.clearInterval(tick);
  }, [session]);

  useEffect(() => {
    if (!session || expiresIn !== 0) {
      return;
    }

    setToast("QR expired. A fresh one is ready.");
    void refreshSession(true);
    // Refresh should only be triggered by the countdown reaching zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresIn, session]);

  async function refreshSession(forceNew = false) {
    if (refreshInFlightRef.current) {
      return refreshInFlightRef.current;
    }

    refreshInFlightRef.current = doRefreshSession(forceNew).finally(() => {
      refreshInFlightRef.current = null;
    });

    return refreshInFlightRef.current;
  }

  async function doRefreshSession(forceNew: boolean) {
    cleanup();
    setStatus("waiting");
    setStats(emptyStats);

    try {
      const saved = readSavedSession();
      if (!forceNew && saved && new Date(saved.expiresAt).getTime() > Date.now() + 5000) {
        setSession(saved);
        setExpiresIn(Math.max(0, Math.ceil((new Date(saved.expiresAt).getTime() - Date.now()) / 1000)));
        connectSocket(saved);
        return;
      }

      const payload = forceNew ? await createSession() : await createInitialSession();
      saveSession(payload);
      setSession(payload);
      setExpiresIn(Math.max(0, Math.ceil((new Date(payload.expiresAt).getTime() - Date.now()) / 1000)));
      connectSocket(payload);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Could not create a session.");
    }
  }

  function connectSocket(payload: SessionPayload) {
    clearHeartbeatTimer();
    const isDev = process.env.NODE_ENV !== "production";
    const logDev = (...args: unknown[]) => {
      if (isDev) {
        console.log("[Viewer Socket Dev]", ...args);
      }
    };

    const socket = io(SOCKET_URL, {
      auth: { sessionId: payload.sessionId, token: payload.token, role: "viewer" },
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelayMax: 5000,
      autoConnect: false,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      logDev("Viewer socket connected:", socket.id, "Transport:", socket.io.engine.transport.name);
      socket.io.engine.on("upgrade", (transport: { name: string }) => {
        logDev("Transport upgraded:", transport.name);
      });
    });

    socket.on("status", (message: { status: SessionStatus }) => {
      logDev("Session status update:", message.status);
      setStatus(message.status);
    });

    socket.on("device-authorized", ({ deviceName }: { deviceName: string }) => {
      logDev("Device authorized:", deviceName);
      setStatus("connecting");
      setToast(`${deviceName} is ready to share.`);
    });

    socket.on("join-session", () => {
      logDev("Join session event received");
      setStatus("connecting");
    });

    socket.on("offer", async ({ payload: offer }: { payload: RTCSessionDescriptionInit }) => {
      logDev("Received WebRTC offer");
      const peer = makePeer(payload.iceServers);
      await peer.setRemoteDescription(offer);
      await flushPendingCandidates(peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      socket.emit("answer", { payload: answer });
      logDev("Emitted WebRTC answer");
    });

    socket.on("ice-candidate", async ({ payload: candidate }: { payload: RTCIceCandidateInit }) => {
      logDev("Received ICE candidate");
      await addIceCandidate(candidate);
    });

    socket.on("disconnect-session", () => {
      logDev("Session disconnected event");
      setStatus("disconnected");
      stopRecording();
    });

    socket.on("expired", (message: { reason: string }) => {
      logDev("Session expired:", message.reason);
      setStatus("expired");
      setToast(message.reason);
      cleanupPeer();
    });

    socket.on("peer-disconnected", ({ role }: { role?: string } = {}) => {
      logDev("Peer disconnected:", role);
      cleanupPeer();
      setStatus("disconnected");
    });

    socket.on("disconnect", (reason) => {
      logDev("Socket disconnected:", reason);
      setStatus("disconnected");
    });

    socket.on("connect_error", (error: Error & { data?: unknown }) => {
      logDev("Socket connect_error:", error.message, error);
      setToast(`Signaling connection error: ${error.message}`);
    });

    socket.on("signal-error", ({ error }: { error: string }) => {
      logDev("Signal error:", error);
      setToast(error);
    });

    socket.io.on("reconnect_attempt", (attempt: number) => {
      logDev("Reconnection attempt #", attempt);
    });

    socket.io.on("reconnect_failed", () => {
      logDev("Reconnection failed");
      setToast("Failed to reconnect to signaling server.");
    });

    heartbeatTimerRef.current = window.setInterval(() => socket.connected && socket.emit("heartbeat"), 20_000);
    socket.connect();
  }

  function makePeer(iceServers: RTCIceServer[]) {
    cleanupPeer();
    pendingCandidatesRef.current = [];
    lastBytesRef.current = 0;
    const peer = new RTCPeerConnection({ iceServers });
    peerRef.current = peer;

    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current?.emit("ice-candidate", { payload: event.candidate.toJSON() });
      }
    };
    peer.ontrack = (event) => {
      const [stream] = event.streams;
      if (videoRef.current && stream) {
        videoRef.current.srcObject = stream;
        void videoRef.current.play().catch(() => setToast("Click the viewer to start playback."));
        setStatus("connected");
        socketRef.current?.emit("connected");
      }
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        setStatus("connected");
      }
      if (["failed", "disconnected", "closed"].includes(peer.connectionState)) {
        setStatus("disconnected");
      }
    };

    return peer;
  }

  useEffect(() => {
    const interval = window.setInterval(async () => {
      const peer = peerRef.current;
      const video = videoRef.current;
      if (!peer || !video) {
        return;
      }

      let reports: RTCStatsReport;
      try {
        reports = await peer.getStats();
      } catch {
        return;
      }
      reports.forEach((report) => {
        if (report.type === "inbound-rtp" && report.kind === "video") {
          const bytes = Number(report.bytesReceived ?? 0);
          const bitrateKbps = Math.max(0, Math.round(((bytes - lastBytesRef.current) * 8) / 1000));
          lastBytesRef.current = bytes;
          const jitterCount = Number(report.jitterBufferEmittedCount ?? 0);
          setStats({
            bitrateKbps,
            fps: Math.round(Number(report.framesPerSecond ?? 0)),
            width: video.videoWidth,
            height: video.videoHeight,
            latencyMs: jitterCount
              ? Math.round((Number(report.jitterBufferDelay ?? 0) / jitterCount) * 1000)
              : 0,
          });
        }
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  function cleanupPeer() {
    const peer = peerRef.current;
    peerRef.current = null;
    pendingCandidatesRef.current = [];
    peer?.close();
    if (videoRef.current?.srcObject instanceof MediaStream) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      videoRef.current.srcObject = null;
    }
  }

  function cleanup() {
    clearHeartbeatTimer();
    stopRecording();
    cleanupPeer();
    socketRef.current?.disconnect();
    socketRef.current = null;
  }

  function clearHeartbeatTimer() {
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
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

  async function copyLink() {
    if (!session) {
      return;
    }
    await navigator.clipboard.writeText(session.connectUrl);
    setToast("Pairing link copied.");
  }

  function takeScreenshot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setToast("No active stream to capture.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        setToast("Could not create a screenshot.");
        return;
      }
      downloadBlob(blob, `mirrorconnect-${session?.sessionId}.png`);
    }, "image/png");
  }

  function toggleRecording() {
    const stream = videoRef.current?.srcObject;
    if (!(stream instanceof MediaStream)) {
      setToast("Start a stream before recording.");
      return;
    }

    if (recorderRef.current?.state === "recording") {
      stopRecording();
      return;
    }

    chunksRef.current = [];
    const mimeType = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "Recording is not supported in this browser.");
      return;
    }
    recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      if (blob.size) {
        downloadBlob(blob, `mirrorconnect-${session?.sessionId}.webm`);
      }
      setIsRecording(false);
    };
    recorder.onerror = () => {
      setIsRecording(false);
      setToast("Recording stopped unexpectedly.");
    };
    recorder.start(1000);
    recorderRef.current = recorder;
    setIsRecording(true);
  }

  function stopRecording() {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  }

  function downloadBlob(blob: Blob, filename: string) {
    const anchor = document.createElement("a");
    const url = URL.createObjectURL(blob);
    anchor.download = filename;
    anchor.href = url;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  async function enterFullscreen() {
    if (!videoRef.current) {
      setToast("No active stream to show fullscreen.");
      return;
    }
    try {
      await videoRef.current.requestFullscreen();
    } catch {
      setToast("Fullscreen is unavailable in this browser.");
    }
  }

  async function disconnect() {
    if (session) {
      await disconnectSession(session.sessionId, session.token).catch(() => undefined);
    }
    cleanupPeer();
    setStatus("disconnected");
  }

  return (
    <main className="min-h-screen px-4 py-5 text-white md:px-8">
      <Toast message={toast} onClose={() => setToast("")} />
      <nav className="mx-auto mb-6 flex max-w-7xl items-center justify-between">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-cyan-200">MirrorConnect</p>
          <h1 className="mt-2 text-3xl font-semibold md:text-5xl">Android screen mirroring</h1>
        </div>
        <div className="flex items-center gap-2">
          <a href="/settings" className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/10">Settings</a>
          <a href="/about" className="rounded-lg border border-white/10 px-4 py-2 text-sm hover:bg-white/10">About</a>
          <button aria-label="Toggle theme" onClick={() => setDark((value) => !value)} className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 hover:bg-white/10">
            {dark ? <Moon size={18} /> : <Sun size={18} />}
          </button>
        </div>
      </nav>

      <section className="mx-auto grid max-w-7xl gap-5 lg:grid-cols-[400px_1fr]">
        <aside className="glass rounded-lg p-5">
          <div className="mb-4 flex items-center justify-between">
            <StatusPill status={status} />
            <span className="font-mono text-sm text-zinc-300">{expiresIn}s</span>
          </div>
          <div className="rounded-lg bg-white p-4 qr-animated">
            {session ? (
              <Image
                src={session.qrDataUrl}
                alt={`QR code for ${session.sessionId}`}
                width={480}
                height={480}
                unoptimized
                className="w-full rounded-md"
              />
            ) : (
              <div className="aspect-square animate-pulse rounded-md bg-zinc-200" />
            )}
          </div>
          <div className="mt-5 rounded-lg border border-white/10 bg-black/20 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-400">Session ID</p>
            <p className="mt-1 font-mono text-3xl font-semibold">{session?.sessionId ?? "......"}</p>
            <p className="mt-3 break-all text-sm text-zinc-300">{session ? displayPairingUrl(session.connectUrl) : "Creating secure pairing link..."}</p>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button onClick={copyLink} disabled={!session} className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-semibold text-zinc-950 disabled:opacity-50">
              <Copy size={16} /> Copy
            </button>
            <button onClick={() => void refreshSession(true)} className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/10">
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
          {expired ? <p className="mt-4 rounded-lg border border-amber-300/20 bg-amber-300/10 p-3 text-sm text-amber-100">This QR can only pair one device and refreshes after five minutes.</p> : null}
        </aside>

        <section className="space-y-5">
          <div className="glass overflow-hidden rounded-lg">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div>
                <p className="text-sm text-zinc-400">Live viewer</p>
                <h2 className="text-xl font-semibold">Phone display</h2>
              </div>
              <div className="flex gap-2">
                <button title="Fullscreen" onClick={() => void enterFullscreen()} className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 hover:bg-white/10"><Maximize size={18} /></button>
                <button title="Screenshot" onClick={takeScreenshot} className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 hover:bg-white/10"><Camera size={18} /></button>
                <button title="Record stream" onClick={toggleRecording} className="grid h-10 w-10 place-items-center rounded-lg border border-white/10 hover:bg-white/10">{isRecording ? <Square size={18} /> : <Video size={18} />}</button>
                <button onClick={disconnect} className="rounded-lg border border-rose-300/30 px-3 py-2 text-sm text-rose-100 hover:bg-rose-400/10">Disconnect</button>
              </div>
            </div>
            <div className="relative grid min-h-[420px] place-items-center bg-black">
              <video ref={videoRef} autoPlay playsInline muted className="max-h-[70vh] w-full bg-black object-contain" />
              {status !== "connected" ? (
                <div className="absolute grid place-items-center text-center">
                  <div className="mx-auto mb-4 h-14 w-14 animate-ping rounded-full border border-cyan-300/70" />
                  <p className="text-lg font-semibold">Waiting for the phone screen</p>
                  <p className="mt-2 max-w-md text-sm text-zinc-400">
                    Scan the QR code on Android, connect, then share the browser screen.
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          <MetricsGrid stats={stats} />
          {!requireSecureContext() ? (
            <div className="rounded-lg border border-rose-300/30 bg-rose-400/10 p-4 text-sm text-rose-100">
              Screen capture requires HTTPS, except on localhost. Deploy behind TLS before using phones on a network.
            </div>
          ) : null}
        </section>
      </section>
    </main>
  );
}

function readSavedSession(): SessionPayload | null {
  try {
    const raw = window.sessionStorage.getItem("mirrorconnect-session");
    if (!raw) {
      return null;
    }
    const saved = JSON.parse(raw) as Partial<SessionPayload>;
    if (
      typeof saved.sessionId !== "string" ||
      typeof saved.token !== "string" ||
      typeof saved.connectUrl !== "string" ||
      typeof saved.qrDataUrl !== "string" ||
      typeof saved.expiresAt !== "string" ||
      !Array.isArray(saved.iceServers)
    ) {
      window.sessionStorage.removeItem("mirrorconnect-session");
      return null;
    }
    return saved as SessionPayload;
  } catch {
    window.sessionStorage.removeItem("mirrorconnect-session");
    return null;
  }
}

function saveSession(session: SessionPayload) {
  try {
    window.sessionStorage.setItem("mirrorconnect-session", JSON.stringify(session));
  } catch {
    // Private browsing may reject sessionStorage; the live session still works.
  }
}

function createInitialSession() {
  if (!initialSessionRequest) {
    initialSessionRequest = createSession().finally(() => {
      initialSessionRequest = null;
    });
  }
  return initialSessionRequest;
}

function displayPairingUrl(url: string) {
  return url.split("?")[0];
}
