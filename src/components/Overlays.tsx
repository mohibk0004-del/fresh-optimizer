import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, History, Info, Loader2, Square, XCircle, Zap } from "lucide-react";
import type { Phase, Toast } from "../lib/hooks";

export function BoostButton({ phase, progress, onBoost, onStop }: { phase: Phase; progress: string; onBoost: () => void; onStop: () => void }) {
  const busy = phase === "boosting" || phase === "stopping" || phase === "reverting";
  const active = phase === "active";
  const label = phase === "boosting" ? `APPLYING ${progress}` : phase === "stopping" ? "STOPPING" : phase === "reverting" ? "REVERTING" : active ? "STOP" : "BOOST RIG";

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center">
      <motion.button
        type="button"
        onClick={active ? onStop : onBoost}
        disabled={busy}
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3, type: "spring", bounce: 0, duration: 0.5 }}
        whileHover={busy ? undefined : { scale: 1.02 }}
        whileTap={busy ? undefined : { scale: 0.97, transition: { duration: 0.08 } }}
        className={`pointer-events-auto relative flex h-[58px] min-w-[230px] items-center justify-center gap-3 rounded-full px-9 text-[15px] font-bold tracking-[0.18em] text-white transition-colors ${
          active
            ? "border border-crimson/50 bg-void-800/90 shadow-crimson-sm backdrop-blur-glass hover:bg-crimson/15"
            : "bg-gradient-to-b from-crimson-400 to-crimson-600 shadow-crimson-md"
        } ${!busy && !active ? "animate-pulse-glow" : ""} disabled:cursor-wait`}
      >
        <span className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />
        {busy ? <Loader2 size={18} className="animate-spin" /> : active ? <Square size={15} fill="currentColor" /> : <Zap size={18} fill="currentColor" />}
        <span className="tabular-nums">{label}</span>
      </motion.button>
    </div>
  );
}

export function ConfirmRevert({ open, entries, onCancel, onConfirm }: { open: boolean; entries: number; onCancel: () => void; onConfirm: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}>
          <motion.div
            role="dialog"
            aria-modal="true"
            className="glass-card glass-card-hero w-[420px] p-6"
            initial={{ scale: 0.96, y: 8, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.96, y: 8, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative z-10">
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-xl border border-crimson-line bg-crimson/10 text-crimson-400">
                <History size={18} />
              </div>
              <h3 className="text-lg font-semibold">Revert to baseline?</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-muted">
                Restores {entries} recorded setting{entries === 1 ? "" : "s"} from <span className="font-mono text-white/80">RestorePoint.json</span>: registry values, NIC
                properties, TCP auto-tuning and your original power plan. The match engine stops and the network adapter may reconnect briefly.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn-ghost !px-4 !py-2" onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" className="rounded-lg bg-crimson px-4 py-2 text-xs font-semibold transition hover:bg-crimson-400 active:scale-[0.97] active:duration-75" onClick={onConfirm}>
                  Revert everything
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="pointer-events-none fixed right-5 top-5 z-50 flex w-[340px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            className="glass-card pointer-events-auto flex items-start gap-2.5 !rounded-xl px-3.5 py-3 text-[13px]"
          >
            <span className="relative z-10 mt-px shrink-0">
              {t.kind === "success" ? <CheckCircle2 size={16} className="text-success" /> : t.kind === "error" ? <XCircle size={16} className="text-crimson-400" /> : <Info size={16} className="text-slate-muted" />}
            </span>
            <span className="relative z-10 leading-snug">{t.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
