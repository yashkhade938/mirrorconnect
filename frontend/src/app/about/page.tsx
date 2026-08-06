import { BadgeHelp, LockKeyhole, RadioTower, ScanLine } from "lucide-react";
import Link from "next/link";

export default function AboutPage() {
  return (
    <main className="min-h-screen px-4 py-8 text-white">
      <section className="mx-auto max-w-4xl">
        <Link href="/" className="text-sm text-cyan-200 hover:text-white">Back to dashboard</Link>
        <div className="glass mt-5 rounded-lg p-6">
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-cyan-200">About</p>
          <h1 className="mt-2 text-4xl font-semibold">MirrorConnect help</h1>
          <p className="mt-4 max-w-2xl text-zinc-300">
            MirrorConnect pairs a desktop browser and an Android browser with a short-lived QR code, then streams the captured phone screen directly over WebRTC.
          </p>
          <div className="mt-8 grid gap-4 md:grid-cols-2">
            {[
              { icon: ScanLine, title: "Pair", text: "Open the dashboard on a PC and scan the animated QR code with Android." },
              { icon: RadioTower, title: "Share", text: "Tap Connect, then Share Screen. Android will ask which browser tab or screen to capture." },
              { icon: LockKeyhole, title: "Secure", text: "Every QR carries a five-minute JWT and accepts only one device for one session." },
              { icon: BadgeHelp, title: "Deploy", text: "Use HTTPS in production. Screen Capture APIs are blocked on insecure origins." },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.title} className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
                  <Icon className="mb-4 text-cyan-200" />
                  <h2 className="text-xl font-semibold">{item.title}</h2>
                  <p className="mt-2 text-sm leading-6 text-zinc-300">{item.text}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}
