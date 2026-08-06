import { CircleDashed, Radio, ShieldCheck, WifiOff } from "lucide-react";
import type { SessionStatus } from "@mirrorconnect/shared";

const statusConfig = {
  waiting: { label: "Waiting", icon: CircleDashed, className: "border-amber-300/30 bg-amber-300/10 text-amber-100" },
  connecting: { label: "Connecting", icon: Radio, className: "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" },
  connected: { label: "Connected", icon: ShieldCheck, className: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100" },
  disconnected: { label: "Disconnected", icon: WifiOff, className: "border-rose-300/30 bg-rose-300/10 text-rose-100" },
  expired: { label: "Expired", icon: WifiOff, className: "border-zinc-300/20 bg-zinc-300/10 text-zinc-200" },
} satisfies Record<SessionStatus, { label: string; icon: typeof CircleDashed; className: string }>;

export function StatusPill({ status }: { status: SessionStatus }) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${config.className}`}>
      <Icon size={14} className={status === "waiting" ? "animate-spin" : ""} />
      {config.label}
    </span>
  );
}
