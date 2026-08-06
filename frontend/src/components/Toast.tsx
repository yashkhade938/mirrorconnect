"use client";

import { X } from "lucide-react";

export function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) {
    return null;
  }

  return (
    <div className="fixed right-4 top-4 z-50 flex max-w-sm items-center gap-3 rounded-lg border border-white/15 bg-zinc-950/90 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur">
      <span className="flex-1">{message}</span>
      <button aria-label="Close notification" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full hover:bg-white/10">
        <X size={16} />
      </button>
    </div>
  );
}
