import { AnimatePresence, motion } from "framer-motion";
import { Activity, Eraser, Gamepad2, Gauge, Loader2, Play, Radar, Wifi, Zap, type LucideIcon } from "lucide-react";
import { GlassCard } from "../components/GlassCard";
import { Sparkline } from "../components/Sparkline";
import { LiveDot, Monogram, StatusIcon, Word } from "../components/ui";
import { GROUPS, jitterWord, pingWord, smoothWord, tweakName } from "../lib/copy";
import { api, errorText } from "../lib/api";
import type { Boost, NetStats, TaskState, ToastKind } from "../lib/hooks";
import type { AppData } from "../lib/useAppData";

interface Props {
  boost: Boost;
  data: AppData;
  net: NetStats;
  goTo: (page: "games" | "network" | "pc" | "tweaks") => void;
  notify: (k: ToastKind, t: string) => void;
}

export function HomePage({ boost, data, net, goTo, notify }: Props) {
  const { phase, engine, tweaks, tasks, enabled } = boost;
  const queue = tweaks.filter((t) => enabled.has(t.id));
  const done = queue.filter((t) => ["applied", "skipped", "failed"].includes(tasks[t.id]?.state ?? "")).length;
  const running = queue.find((t) => tasks[t.id]?.state === "running");
  const anyApplied = Object.values(tasks).some((r) => r.state === "applied");
  const liveGame = engine?.activeGames[0];

  const hero =
    phase === "boosting"
      ? { title: "Boosting your PC…", body: running ? tweakName(running.id, running.name) : "Finishing up" }
      : phase === "reverting"
        ? { title: "Putting things back…", body: "Restoring every setting to how it was before." }
        : liveGame
          ? { title: `Playing ${liveGame.game}`, body: "Full power is on and your game is first in line." }
          : engine?.running
            ? { title: "You're boosted", body: "Launch a game and we'll switch to full power automatically." }
            : anyApplied
              ? { title: "Boost is paused", body: "Your tweaks are still on. Press Boost to start watching for games again." }
              : { title: "Ready when you are", body: "One click tunes Windows and your network for smoother, lower-lag games. You can undo it anytime." };

  const groupState = (cats: string[]): TaskState => {
    const rows = tweaks.filter((t) => cats.includes(t.category) && enabled.has(t.id)).map((t) => tasks[t.id]?.state ?? "idle");
    if (!rows.length) return "idle";
    if (rows.includes("running")) return "running";
    if (rows.includes("applied")) return "applied";
    if (rows.every((r) => r === "skipped")) return "skipped";
    if (rows.includes("failed")) return "failed";
    if (rows.includes("queued")) return "queued";
    return "idle";
  };

  const lastGame = data.games?.find((g) => g.running) ?? data.games?.find((g) => g.installed);
  const run = async (fn: () => Promise<string>, ok: (m: string) => string) => {
    try {
      notify("success", ok(await fn()));
    } catch (e) {
      notify("error", errorText(e));
    }
  };

  const ping = pingWord(net.samples.length ? net.avg : null);
  const jitter = jitterWord(net.jitter);
  const smooth = smoothWord(data.latency?.score ?? null);
  const installed = data.games?.filter((g) => g.installed) ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      {/* Hero */}
      <GlassCard hero title="Status" icon={Activity} className="!pb-5">
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-center gap-6">
          <div className="flex items-center gap-5">
            <BigRing pct={queue.length ? done / queue.length : 0} phase={phase} live={!!liveGame} armed={!!engine?.running} />
            <div className="min-w-0">
              <AnimatePresence mode="wait">
                <motion.div key={hero.title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ type: "spring", bounce: 0, duration: 0.3 }}>
                  <h2 className="text-[24px] font-bold leading-tight tracking-[-0.02em]">{hero.title}</h2>
                  <p className="mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-slate-muted">{hero.body}</p>
                </motion.div>
              </AnimatePresence>
              {phase === "boosting" && (
                <div className="mt-3 h-1.5 w-[260px] overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div className="bg-accent-fill h-full rounded-full" animate={{ width: `${(done / Math.max(1, queue.length)) * 100}%` }} transition={{ type: "spring", bounce: 0, duration: 0.4 }} />
                </div>
              )}
            </div>
          </div>

          <ul className="grid grid-cols-2 gap-2">
            {GROUPS.map((g) => {
              const st = groupState(g.cats);
              return (
                <li key={g.id} className="glass-inset flex items-center gap-3 px-3.5 py-3">
                  <StatusIcon state={st} size={20} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold">{g.title}</div>
                    <div className="truncate text-[11px] text-slate-muted">{g.blurb}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </GlassCard>

      {/* Three plain stats */}
      <div className="grid grid-cols-3 gap-3.5">
        <button type="button" onClick={() => goTo("network")} className="glass-card group flex flex-col p-4 text-left transition-transform active:scale-[0.99]">
          <div className="relative z-10 flex items-center justify-between">
            <span className="label flex items-center gap-1.5">
              <Wifi size={12} /> Connection
            </span>
            <span className="text-[11px] text-slate-muted opacity-0 transition-opacity group-hover:opacity-100">Details →</span>
          </div>
          <div className="relative z-10 mt-2 text-[22px] font-bold tracking-tight">
            <Word tone={ping.tone}>{ping.word}</Word>
          </div>
          <div className="relative z-10 text-[12px] text-slate-muted">
            {net.samples.length ? `${net.avg.toFixed(0)} ms ping · ${jitter.word.toLowerCase()}` : "Measuring your ping…"}
          </div>
          <div className="relative z-10 -mx-1 mt-2 h-[46px]">
            <Sparkline samples={net.samples} height={46} />
          </div>
        </button>

        <button type="button" onClick={() => goTo("pc")} className="glass-card group flex flex-col p-4 text-left transition-transform active:scale-[0.99]">
          <div className="relative z-10 flex items-center justify-between">
            <span className="label flex items-center gap-1.5">
              <Gauge size={12} /> Smoothness
            </span>
            <span className="text-[11px] text-slate-muted opacity-0 transition-opacity group-hover:opacity-100">Details →</span>
          </div>
          <div className="relative z-10 mt-2 text-[22px] font-bold tracking-tight">
            <Word tone={data.latencyBusy ? "off" : smooth.tone}>{data.latencyBusy ? "Testing…" : smooth.word}</Word>
          </div>
          <div className="relative z-10 text-[12px] leading-relaxed text-slate-muted">
            {data.latency ? `Typical driver interruption: ${Math.round(data.latency.typicalUs)} µs.` : "Checks if drivers cause stutter."}
          </div>
          <div className="relative z-10 mt-auto pt-2 text-[12px] text-slate-muted">
            Score <span className="font-semibold tabular-nums text-white">{data.latency?.score ?? "—"}</span>/100
          </div>
        </button>

        <button type="button" onClick={() => goTo("games")} className="glass-card group flex flex-col p-4 text-left transition-transform active:scale-[0.99]">
          <div className="relative z-10 flex items-center justify-between">
            <span className="label flex items-center gap-1.5">
              <Gamepad2 size={12} /> Games
            </span>
            <span className="text-[11px] text-slate-muted opacity-0 transition-opacity group-hover:opacity-100">Details →</span>
          </div>
          <div className="relative z-10 mt-2 text-[22px] font-bold tracking-tight">
            {data.games === null ? <span className="text-slate-muted">Looking…</span> : `${installed.length} found`}
          </div>
          <div className="relative z-10 text-[12px] text-slate-muted">
            {liveGame ? (
              <span className="flex items-center gap-1.5 text-white">
                <LiveDot /> Playing {liveGame.game}
              </span>
            ) : installed.length ? (
              installed.map((g) => g.name).join(", ")
            ) : (
              "No supported games installed yet."
            )}
          </div>
          {installed.some((g) => data.icons[g.id]) && (
            <div className="relative z-10 mt-auto flex gap-2 pt-3">
              {installed.map((g) => (
                <Monogram key={g.id} id={g.id} icon={data.icons[g.id]} size={30} live={liveGame?.game === g.name} />
              ))}
            </div>
          )}
        </button>
      </div>

      {/* Quick actions + activity */}
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-3.5">
        <GlassCard title="Quick actions" icon={Zap}>
          <div className="grid flex-1 grid-cols-2 gap-2">
            <Action icon={Play} title={lastGame ? `Play ${lastGame.name}` : "Play a game"} body={lastGame ? "Launches through its own launcher" : "No supported games found yet"} disabled={!lastGame} onClick={() => lastGame && run(() => api.launchGame(lastGame.id), (m) => `${m}…`)} />
            <Action icon={Gauge} title="Smoothness test" body="Checks drivers for stutter" busy={data.latencyBusy} onClick={() => { data.measure(); }} />
            <Action icon={Radar} title="Check game routes" body="Ping, stability and drops" busy={data.probing} onClick={() => { data.runProbe(); goTo("network"); }} />
            <Action icon={Eraser} title="Clear DNS cache" body="Fixes some can't-connect errors" onClick={() => run(api.flushDns, () => "DNS cache cleared.")} />
          </div>
        </GlassCard>

        <GlassCard title="Activity" icon={Activity}>
          <AnimatePresence initial={false}>
            {boost.events.length === 0 ? (
              <p className="text-[12.5px] leading-relaxed text-slate-muted">
                {engine?.running ? "Waiting for you to launch a game…" : "Nothing yet. Press Boost and we'll log what we do here."}
              </p>
            ) : (
              <ul className="space-y-2 overflow-hidden">
                {boost.events.slice(0, 5).map((e) => (
                  <motion.li key={e.t + e.text} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="text-[12.5px] leading-snug">
                    <span className="mr-2 tabular-nums text-slate-muted">{new Date(e.t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    <span className={e.tone === "ok" ? "text-white" : e.tone === "warn" ? "text-warn" : "text-white/70"}>{e.text}</span>
                  </motion.li>
                ))}
              </ul>
            )}
          </AnimatePresence>
          <button type="button" className="btn-ghost mt-auto self-start" onClick={() => goTo("tweaks")}>
            Choose what Boost changes
          </button>
        </GlassCard>
      </div>
    </div>
  );
}

function BigRing({ pct, phase, live, armed }: { pct: number; phase: string; live: boolean; armed: boolean }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const full = phase !== "boosting" && armed;
  const color = live ? "#00FF9D" : "url(#fo-accent-ring)";
  return (
    <div className="relative grid h-[112px] w-[112px] shrink-0 place-items-center">
      <svg viewBox="0 0 104 104" className="absolute inset-0 -rotate-90">
        <circle cx="52" cy="52" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8" />
        <motion.circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          style={{ stroke: color }}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - (full ? 1 : pct)) }}
          transition={{ type: "spring", bounce: 0, duration: 0.6 }}
        />
      </svg>
      <div className="text-center leading-none">
        <div className="text-[22px] font-bold tabular-nums">{phase === "boosting" ? `${Math.round(pct * 100)}%` : live ? "ON" : armed ? "ON" : "OFF"}</div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-muted">{live ? "in game" : "boost"}</div>
      </div>
    </div>
  );
}

function Action({ icon: Icon, title, body, onClick, busy, disabled }: { icon: LucideIcon; title: string; body: string; onClick: () => void; busy?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy || disabled}
      className="glass-inset group flex items-center gap-3 px-3.5 py-3 text-left transition-colors hover:border-white/15 active:scale-[0.98] disabled:opacity-50"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-crimson-line bg-crimson/10 text-crimson-400">
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Icon size={16} />}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
        <span className="block truncate text-[11.5px] text-slate-muted">{body}</span>
      </span>
    </button>
  );
}
