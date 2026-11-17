"use client";

import { useState } from "react";

const CLIENTS = [
  { id: "boleluxe", name: "Bole Luxe Fashion", handle: "@boleluxe", er: "6.8%" },
  { id: "kejela15", name: "Kejela Fitness", handle: "@kejela15", er: "9.2%" },
  { id: "addiskitchen", name: "Addis Kitchen Co.", handle: "@addiskitchen", er: "7.4%" },
  { id: "habesharealty", name: "Habesha Realty", handle: "@habesharealty", er: "5.1%" },
];

const KPIS = [
  { label: "Client Workspaces", value: "4", accent: "text-indigo-300" },
  { label: "Audits Run", value: "128", accent: "text-cyan-300" },
  { label: "Video Roasts", value: "46", accent: "text-violet-300" },
  { label: "Avg Engagement", value: "7.1%", accent: "text-emerald-300" },
];

const FEED = [
  { kind: "Audit", target: "@kejela15 · TikTok", meta: "182K views · ER 9.2%", when: "2h" },
  { kind: "Roast", target: "Bole Luxe draft #12", meta: "Hook 7/10 · Pacing 6/10", when: "5h" },
  { kind: "Spy", target: "@addiskitchen · TikTok", meta: "94K views · ER 7.4%", when: "1d" },
  { kind: "Audit", target: "@habesharealty · IG", meta: "37K views · ER 5.1%", when: "2d" },
];

const GLASS =
  "backdrop-blur-xl bg-white/[0.04] border border-white/10 rounded-2xl shadow-2xl";
const PILL =
  "bg-white/10 hover:bg-white/20 border border-white/15 backdrop-blur-md transition rounded-full";

export default function HomePage() {
  const [active, setActive] = useState(CLIENTS[0].id);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#06080f] text-slate-100 antialiased">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-[28rem] w-[28rem] rounded-full bg-indigo-600/25 blur-3xl" />
        <div className="absolute -right-24 top-24 h-80 w-80 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="absolute -bottom-32 left-1/3 h-[26rem] w-[26rem] rounded-full bg-violet-600/20 blur-3xl" />
      </div>

      <main className="relative mx-auto w-full max-w-5xl px-5 py-10">
        <header className={`${GLASS} flex flex-wrap items-center justify-between gap-4 p-5`}>
          <div className="flex items-center gap-4">
            <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-indigo-500/30 to-cyan-500/20 text-xl">
              🚀
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight">
                  @AddisSocialStrategistBot
                </h1>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Online
                </span>
              </div>
              <p className="text-xs text-slate-400">TikTok · Instagram · Gemini · Apify</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="/api/telegram?setup=true"
              className={`${PILL} px-4 py-2 text-sm font-medium text-slate-100`}
            >
              🔗 Connect Webhook
            </a>
            <button
              onClick={() => window.location.reload()}
              className={`${PILL} px-4 py-2 text-sm font-medium text-slate-100`}
            >
              ↻ Refresh
            </button>
          </div>
        </header>

        <section className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {KPIS.map((k) => (
            <div key={k.label} className={`${GLASS} p-4`}>
              <p className="text-[11px] uppercase tracking-wider text-slate-400">{k.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${k.accent}`}>{k.value}</p>
            </div>
          ))}
        </section>

        <section className={`${GLASS} mt-6 p-5`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-200">Client Workspaces</h2>
            <span className="text-[11px] text-slate-500">tap to switch</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {CLIENTS.map((c) => {
              const on = c.id === active;
              return (
                <button
                  key={c.id}
                  onClick={() => setActive(c.id)}
                  className={`${PILL} px-3.5 py-2 text-xs ${
                    on ? "border-indigo-400/40 bg-indigo-500/20 text-white" : "text-slate-300"
                  }`}
                >
                  <span className="font-medium">
                    {on ? "✅ " : "🏢 "}
                    {c.name}
                  </span>
                  <span className="ml-2 text-slate-400">
                    {c.handle} · {c.er}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className={`${GLASS} mt-6 p-5`}>
          <h2 className="mb-2 text-sm font-semibold text-slate-200">Recent Activity</h2>
          <ul className="divide-y divide-white/5">
            {FEED.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-3">
                  <span className="rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-slate-300">
                    {f.kind}
                  </span>
                  <span className="text-sm text-slate-200">{f.target}</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="hidden text-slate-400 sm:inline">{f.meta}</span>
                  <span className="text-slate-600">{f.when}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <p className="mt-6 text-center text-[11px] text-slate-600">
          SocialPulse AI · agency social media strategist
        </p>
      </main>
    </div>
  );
}
