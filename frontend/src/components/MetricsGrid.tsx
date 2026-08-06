import { Gauge, Monitor, Timer, Video } from "lucide-react";
import type { WebRtcStats } from "@mirrorconnect/shared";

export function MetricsGrid({ stats }: { stats: WebRtcStats }) {
  const items = [
    { label: "Bitrate", value: `${stats.bitrateKbps} kbps`, icon: Gauge },
    { label: "FPS", value: `${stats.fps}`, icon: Video },
    { label: "Resolution", value: stats.width && stats.height ? `${stats.width}x${stats.height}` : "0x0", icon: Monitor },
    { label: "Latency", value: `${stats.latencyMs} ms`, icon: Timer },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <div key={item.label} className="rounded-lg border border-white/10 bg-white/[0.06] p-4">
            <div className="mb-3 flex items-center justify-between text-zinc-400">
              <span className="text-xs uppercase tracking-wider">{item.label}</span>
              <Icon size={16} />
            </div>
            <p className="text-xl font-semibold text-white">{item.value}</p>
          </div>
        );
      })}
    </div>
  );
}
