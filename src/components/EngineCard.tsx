import { AnimatePresence, motion } from "framer-motion";
import { Activity, AlertTriangle, Check, Loader2, Minus, X } from "lucide-react";
import type { NetStats, Phase, TaskRow, TaskState } from "../lib/hooks";
import type { EngineStatus, TweakCategory, TweakInfo } from "../lib/types";
import { GlassCard } from "./GlassCard";
import { Sparkline } from "./Sparkline";

interface Props {
  tweaks: TweakInfo[];
  enabled: Set<string>;
  tasks: Record<string, TaskRow>;
  nicRestart: TaskState;
  phase: Phase;
  engine: EngineStatus | null;
  events: { t: number; text: string; tone: "ok" | "warn" | "info" }[];
  net: NetStats;
  onToggle: (id: string) => void;
  highlight?: boolean;
}

const CAT_LABEL: Record<TweakCategory, string> = { network: "TCP/IP", nic: "NIC", system: "Windows", game: "Game", power: "Power" };

export function EngineCard({ tweaks, enabled, tasks, nicRestart, phase, engine, events, net, onToggle, highlight }: Props) {
  const queue = tweaks.filter((t) => enabled.has(t.id));
  const done = queue.filter((t) => ["applied", "skipped", "failed"].includes(tasks[t.id]?.state ?? "")).length;
  const applied = queue.filter((t) => tasks[t.id]?.state === "applied").length;
  const pct = queue.length ? done / queue.length : 0;
  const inMatch = (engine?.activeGames.length ?? 0) > 0;

  const status =
    phase === "boosting"
      ? { text: "Applying", cls: "border-crimson-line bg-crimson/15 text-crimson-400" }
      : inMatch
        ? { text: "Match mode", cls: "border-success/30 bg-success/10 text-success" }
        : engine?.running
          ? { text: "Armed · watching", cls: "border-crimson-line bg-crimson/10 text-white" }
          : { text: "Idle", cls: "border-obsidian-line bg-white/[0.03] text-slate-muted" };

  return (
    <GlassCard
      id="engine"
      hero
      title="Active Optimization Engine"
      subtitle="Snapshot → apply → watch. Every change is reversible."
      icon={Activity}
      highlight={highlight}
      delay={0.1}
      action={
        <span className={`chip ${status.cls}`}>
          {(phase === "boosting" || engine?.running) && <span className={`h-1.5 w-1.5 rounded-full ${inMatch ? "bg-success" : "bg-crimson"} animate-pulse`} />}
          {status.text}
        </span>
      }
    >
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-4">
        {/* left: progress + live graph + events */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="glass-inset flex items-center gap-4 px-4 py-3.5">
            <ProgressRing pct={pct} spinning={phase === "boosting"} label={`${applied}`} />
            <div className="min-w-0">
              <div className="text-sm font-semibold">
                {phase === "boosting" ? "Optimizing rig…" : done && queue.length === done ? "Optimization complete" : `${queue.length} tweaks queued`}
              </div>
              <div className="mt-0.5 text-xs tabular-nums text-slate-muted">
                {applied} applied · {queue.filter((t) => tasks[t.id]?.state === "skipped").length} skipped ·{" "}
                {queue.filter((t) => tasks[t.id]?.state === "failed").length} failed
              </div>
              <div className="mt-1.5 text-[11px] text-slate-muted">
                Timer <span className={engine?.timerHeld ? "text-success" : "text-white/80"}>{engine?.timerHeld ? "0.5 ms" : "default"}</span> · Power{" "}
                <span className={engine?.powerSchemeActive ? "text-success" : "text-white/80"}>{engine?.powerSchemeActive ? "Low-DPC" : "user"}</span>
              </div>
            </div>
          </div>

          <div className="glass-inset flex min-h-[120px] flex-1 flex-col px-4 pb-2 pt-3">
            <div className="flex items-baseline justify-between">
              <span className="label">Live latency · 1.1.1.1</span>
              <span className="text-lg font-semibold tabular-nums">
                {net.samples.length === 0 ? "—" : net.last === null ? <span className="text-crimson-400">lost</span> : net.last.toFixed(1)}
                <span className="ml-0.5 text-[11px] font-medium text-slate-muted">ms</span>
              </span>
            </div>
            <div className="relative -mx-1 mt-2 min-h-0 flex-1">
              <Sparkline samples={net.samples} />
            </div>
          </div>

          <div className="glass-inset h-[78px] overflow-hidden px-3.5 py-2.5">
            <div className="label mb-1">Engine log</div>
            <AnimatePresence initial={false}>
              {events.length === 0 ? (
                <div className="text-[11px] text-slate-muted">{engine?.running ? "Waiting for a supported game to launch…" : "Press BOOST RIG to arm the match engine."}</div>
              ) : (
                events.slice(0, 2).map((e) => (
                  <motion.div key={e.t + e.text} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 truncate text-[11px]">
                    <span className="tabular-nums text-slate-muted">{new Date(e.t).toLocaleTimeString([], { hour12: false })}</span>
                    <span className={e.tone === "ok" ? "text-success" : e.tone === "warn" ? "text-warn" : "text-white/80"}>{e.text}</span>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* right: task runner */}
        <div className="glass-inset flex min-h-0 flex-col py-2">
          <div className="flex items-center justify-between px-3.5 pb-1.5 pt-1">
            <span className="label">Task runner</span>
            {phase === "idle" && <span className="text-[10px] text-slate-muted">click to toggle</span>}
          </div>
          <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5">
            {tweaks.map((t) => (
              <TaskItem key={t.id} tweak={t} row={tasks[t.id]} on={enabled.has(t.id)} locked={phase !== "idle"} onToggle={() => onToggle(t.id)} />
            ))}
            {nicRestart !== "idle" && (
              <li className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                <StateIcon state={nicRestart} on />
                <span className="text-[12px] font-medium">Restart network adapter (once)</span>
              </li>
            )}
          </ul>
        </div>
      </div>
    </GlassCard>
  );
}

function TaskItem({ tweak, row, on, locked, onToggle }: { tweak: TweakInfo; row?: TaskRow; on: boolean; locked: boolean; onToggle: () => void }) {
  const state = row?.state ?? "idle";
  const active = state === "running";
  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        disabled={locked}
        title={`${tweak.description}${row?.detail ? `\n\n${row.detail}` : ""}`}
        className={`group flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
          active ? "bg-crimson/10" : "hover:bg-white/[0.03]"
        } ${on ? "" : "opacity-40"} disabled:cursor-default`}
      >
        <StateIcon state={state} on={on} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 truncate text-[12px] font-medium">
            {tweak.name}
            {tweak.caution && <AlertTriangle size={11} className="shrink-0 text-warn" aria-label={tweak.caution} />}
          </div>
          {row?.detail && state !== "idle" && <div className="truncate text-[10.5px] text-slate-muted">{row.detail}</div>}
        </div>
        <span className="shrink-0 rounded-md border border-obsidian-line px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-slate-muted">
          {CAT_LABEL[tweak.category]}
        </span>
      </button>
    </li>
  );
}

function StateIcon({ state, on }: { state: TaskState; on: boolean }) {
  const box = "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full";
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span key={state} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", bounce: 0, duration: 0.25 }} className="shrink-0">
        {state === "running" ? (
          <Loader2 size={18} className="animate-spin text-crimson-400" />
        ) : state === "applied" ? (
          <span className={`${box} bg-success text-void shadow-success-sm`}>
            <Check size={12} strokeWidth={3.5} />
          </span>
        ) : state === "skipped" ? (
          <span className={`${box} border border-obsidian-line bg-white/[0.06] text-slate-muted`}>
            <Minus size={11} strokeWidth={3} />
          </span>
        ) : state === "failed" ? (
          <span className={`${box} bg-crimson text-white`}>
            <X size={11} strokeWidth={3.5} />
          </span>
        ) : state === "queued" ? (
          <span className={`${box} border border-crimson-line`} />
        ) : (
          <span className={`${box} border ${on ? "border-crimson/70 bg-crimson/20" : "border-white/15"}`}>{on && <span className="h-1.5 w-1.5 rounded-full bg-crimson" />}</span>
        )}
      </motion.span>
    </AnimatePresence>
  );
}

function ProgressRing({ pct, spinning, label }: { pct: number; spinning: boolean; label: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid h-[76px] w-[76px] shrink-0 place-items-center">
      <svg viewBox="0 0 72 72" className="absolute inset-0 -rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <motion.circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke="#FF1E27"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: "drop-shadow(0 0 3px rgba(255,30,39,0.35))" }}
        />
      </svg>
      {spinning && (
        <motion.div className="absolute inset-[3px] rounded-full border-2 border-transparent border-t-crimson-400/80" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }} />
      )}
      <div className="text-center leading-none">
        <div className="text-xl font-bold tabular-nums">{label}</div>
        <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-muted">applied</div>
      </div>
    </div>
  );
}
