import { AnimatePresence, motion } from "framer-motion";
import { History, Loader2, Square, Zap } from "lucide-react";
import type { Phase } from "../lib/hooks";

export function BoostButton({ phase, progress, onBoost, onStop }: { phase: Phase; progress: string; onBoost: () => void; onStop: () => void }) {
  const busy = phase === "boosting" || phase === "stopping" || phase === "reverting";
  const active = phase === "active";
  const label = phase === "boosting" ? `Boosting ${progress}` : phase === "stopping" ? "Pausing…" : phase === "reverting" ? "Undoing…" : active ? "Pause boost" : "Boost";

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
        className={`pointer-events-auto relative flex h-[58px] min-w-[230px] items-center justify-center gap-3 rounded-full px-9 text-[16px] font-semibold tracking-[0.01em] text-white transition-colors ${
          active
            ? "border border-crimson/50 bg-void-800/90 shadow-crimson-sm backdrop-blur-glass hover:bg-crimson/15"
            : "bg-accent-fill shadow-crimson-md hover:brightness-110"
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
              <h3 className="text-lg font-semibold">Undo all changes?</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-muted">
                This puts back all {entries} setting{entries === 1 ? "" : "s"} FreshOptimizer changed, exactly as they were before. Your internet may drop for a
                second while your network card restarts.
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn-ghost !px-4 !py-2" onClick={onCancel}>
                  Cancel
                </button>
                <button type="button" className="bg-accent-fill rounded-lg px-4 py-2 text-xs font-semibold transition hover:brightness-110 active:scale-[0.97] active:duration-75" onClick={onConfirm}>
                  Undo everything
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
