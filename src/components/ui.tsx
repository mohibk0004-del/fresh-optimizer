import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Minus, X } from "lucide-react";
import type { ReactNode } from "react";
import type { TaskState } from "../lib/hooks";
import { toneText, type Tone } from "../lib/copy";

export function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full border transition-colors active:scale-[0.95] disabled:cursor-not-allowed disabled:opacity-50 ${
        on ? "border-crimson/60 bg-crimson" : "border-white/10 bg-white/[0.08]"
      }`}
    >
      <motion.span
        className="absolute top-[2px] h-4 w-4 rounded-full bg-white shadow"
        initial={false}
        animate={{ left: on ? 18 : 2 }}
        transition={{ type: "spring", bounce: 0, duration: 0.25 }}
      />
    </button>
  );
}

export function StatusIcon({ state, size = 18 }: { state: TaskState; size?: number }) {
  const box = "grid shrink-0 place-items-center rounded-full";
  const dim = { width: size, height: size };
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={state}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ type: "spring", bounce: 0, duration: 0.25 }}
        className="shrink-0"
      >
        {state === "running" ? (
          <Loader2 size={size} className="animate-spin text-crimson-400" />
        ) : state === "applied" ? (
          <span className={`${box} bg-success text-void`} style={dim}>
            <Check size={size * 0.66} strokeWidth={3.5} />
          </span>
        ) : state === "skipped" ? (
          <span className={`${box} border border-obsidian-line bg-white/[0.06] text-slate-muted`} style={dim}>
            <Minus size={size * 0.6} strokeWidth={3} />
          </span>
        ) : state === "failed" ? (
          <span className={`${box} bg-crimson text-white`} style={dim}>
            <X size={size * 0.6} strokeWidth={3.5} />
          </span>
        ) : (
          <span className={`${box} border ${state === "queued" ? "border-crimson-line" : "border-white/15"}`} style={dim} />
        )}
      </motion.span>
    </AnimatePresence>
  );
}

export function StatusText({ state, detail }: { state: TaskState; detail?: string }) {
  const map: Partial<Record<TaskState, [string, string]>> = {
    applied: ["Done", "text-success"],
    skipped: ["Not needed", "text-slate-muted"],
    failed: ["Didn't work", "text-crimson-400"],
    running: ["Working…", "text-crimson-400"],
    queued: ["Up next", "text-slate-muted"],
  };
  const m = map[state];
  if (!m) return null;
  return (
    <span className={`text-[11px] font-medium ${m[1]}`} title={detail}>
      {m[0]}
    </span>
  );
}

const MONO: Record<string, string> = { valorant: "VL", cs2: "CS", apex: "AX", overwatch: "OW" };

export function Monogram({ id, live, size = 32 }: { id: string; live?: boolean; size?: number }) {
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-lg font-bold tracking-wide ${live ? "bg-crimson text-white" : "border border-obsidian-line bg-white/[0.04] text-white/70"}`}
      style={{ width: size, height: size, fontSize: size * 0.34 }}
    >
      {MONO[id] ?? "?"}
    </div>
  );
}

export function LiveDot() {
  return (
    <span className="relative flex h-1.5 w-1.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-crimson opacity-60" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-crimson" />
    </span>
  );
}

export function Word({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`font-semibold ${toneText[tone]}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-4 px-1">
      <div>
        <h1 className="text-[26px] font-bold leading-tight tracking-[-0.02em]">{title}</h1>
        <p className="mt-1 text-[13px] text-slate-muted">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
