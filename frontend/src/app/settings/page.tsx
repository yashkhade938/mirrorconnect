"use client";

import { useEffect, useState } from "react";
import { Moon, RotateCcw, ServerCog, Sun } from "lucide-react";
import Link from "next/link";

type Settings = {
  stunUrl: string;
  turnUrl: string;
  turnUsername: string;
  darkMode: boolean;
};

const defaults: Settings = {
  stunUrl: "stun:stun.l.google.com:19302",
  turnUrl: "",
  turnUsername: "",
  darkMode: true,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState(defaults);

  useEffect(() => {
    const saved = window.localStorage.getItem("mirrorconnect-settings");
    if (saved) {
      setSettings({ ...defaults, ...JSON.parse(saved) });
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("mirrorconnect-settings", JSON.stringify(settings));
    document.body.classList.toggle("light-theme", !settings.darkMode);
  }, [settings]);

  return (
    <main className="min-h-screen px-4 py-8 text-white">
      <section className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-cyan-200 hover:text-white">Back to dashboard</Link>
        <div className="glass mt-5 rounded-lg p-6">
          <div className="mb-6 flex items-center gap-3">
            <ServerCog className="text-cyan-200" />
            <div>
              <p className="font-mono text-xs uppercase tracking-[0.35em] text-cyan-200">Settings</p>
              <h1 className="text-3xl font-semibold">Network and theme</h1>
            </div>
          </div>

          <div className="grid gap-4">
            <Field label="STUN URL" value={settings.stunUrl} onChange={(stunUrl) => setSettings((current) => ({ ...current, stunUrl }))} />
            <Field label="TURN URL" value={settings.turnUrl} onChange={(turnUrl) => setSettings((current) => ({ ...current, turnUrl }))} />
            <Field label="TURN Username" value={settings.turnUsername} onChange={(turnUsername) => setSettings((current) => ({ ...current, turnUsername }))} />
            <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/[0.05] p-4">
              <div>
                <p className="font-semibold">Theme</p>
                <p className="text-sm text-zinc-400">Saved locally for this browser.</p>
              </div>
              <button onClick={() => setSettings((current) => ({ ...current, darkMode: !current.darkMode }))} className="grid h-11 w-11 place-items-center rounded-lg border border-white/10 hover:bg-white/10">
                {settings.darkMode ? <Moon size={18} /> : <Sun size={18} />}
              </button>
            </div>
            <button onClick={() => setSettings(defaults)} className="inline-flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 font-semibold text-zinc-950">
              <RotateCcw size={18} /> Reset Settings
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm text-zinc-300">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-lg border border-white/10 bg-white/10 px-4 py-3 outline-none ring-cyan-300/40 focus:ring-4" />
    </label>
  );
}
