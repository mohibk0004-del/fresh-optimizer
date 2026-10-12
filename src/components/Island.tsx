import { AnimatePresence, motion, type PanInfo } from "framer-motion";
import { CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { Toast, ToastKind } from "../lib/hooks";

/** Persistent compact state shown when there's no notification (iOS "Live Activity"). */
export interface LiveActivity {
  key: string;
  icon: "spinner" | "live";
  text: string;
}

const DURATION_MS = 4200;
const COMPACT = { width: 128, height: 30, borderRadius: 15 };
const LIVE = { width: 236, height: 30, borderRadius: 15 };
const CARD = { width: 384, height: 68, borderRadius: 24 };
/** The island physically expands, so a touch of bounce reads as momentum. */
const MORPH = { type: "spring" as const, bounce: 0.28, duration: 0.55 };
const SETTLE = { type: "spring" as const, bounce: 0, duration: 0.35 };

const KIND: Record<ToastKind, { color: string; title: string; icon: ReactNode }> = {
  success: { color: "#00FF9D", title: "Done", icon: <CheckCircle2 size={22} /> },
  error: { color: "#FF5A63", title: "Something went wrong", icon: <XCircle size={22} /> },
  info: { color: "rgb(var(--accent-hi))", title: "FreshOptimizer", icon: <Info size={22} /> },
};

/**
 * Dynamic-Island style notifications. A black pill lives in the title bar;
 * a notification springs it open into a card, then it shrinks back. Drag up
 * or click to dismiss; hovering pauses the timer.
 */
export function Island({ toasts, dismiss, live }: { toasts: Toast[]; dismiss: (id: number) => void; live: LiveActivity | null }) {
  const current = toasts[0] ?? null;
  const [paused, setPaused] = useState(false);
  const remaining = useRef(DURATION_MS);
  const started = useRef(0);

  const close = useCallback(() => {
    if (current) dismiss(current.id);
  }, [current, dismiss]);

  // Auto-dismiss, pausable on hover.
  useEffect(() => {
    if (!current) return;
    remaining.current = DURATION_MS;
  }, [current?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!current || paused) return;
    started.current = performance.now();
    const t = window.setTimeout(close, remaining.current);
    return () => {
      window.clearTimeout(t);
      remaining.current = Math.max(600, remaining.current - (performance.now() - started.current));
    };
  }, [current, paused, close]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y < -18 || info.velocity.y < -300) close();
  };

  const shape = current ? CARD : live ? LIVE : COMPACT;
  const visible = !!current || !!live;
  const k = current ? KIND[current.kind] : null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-[3px] z-[80] flex justify-center">
      <AnimatePresence>
        {visible && (
          <motion.div
            key="island"
            role="status"
            aria-live="polite"
            className="pointer-events-auto relative cursor-pointer overflow-hidden bg-black text-white shadow-[0_10px_40px_-8px_rgba(0,0,0,0.85),inset_0_0_0_1px_rgba(255,255,255,0.07)]"
            initial={{ ...COMPACT, opacity: 0, scale: 0.6, y: -6 }}
            animate={{ ...shape, opacity: 1, scale: 1, y: 0 }}
            exit={{ ...COMPACT, opacity: 0, scale: 0.6, y: -6 }}
            transition={MORPH}
            drag={current ? "y" : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.5, bottom: 0.05 }}
            onDragEnd={onDragEnd}
            onClick={close}
            onHoverStart={() => setPaused(true)}
            onHoverEnd={() => setPaused(false)}
          >
            <AnimatePresence mode="wait" initial={false}>
              {current && k ? (
                <motion.div
                  key={`n${current.id}`}
                  className="absolute inset-0 flex items-center gap-3 px-4"
                  initial={{ opacity: 0, filter: "blur(8px)", scale: 0.96 }}
                  animate={{ opacity: 1, filter: "blur(0px)", scale: 1, transition: { ...SETTLE, delay: 0.12 } }}
                  exit={{ opacity: 0, filter: "blur(6px)", scale: 0.97, transition: { duration: 0.14 } }}
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${k.color} 16%, transparent)`, color: k.color }}>
                    {k.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold" style={{ color: k.color }}>
                      {current.title ?? k.title}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block text-[12px] leading-snug text-white/85">{current.text}</span>
                  </span>
                  {toasts.length > 1 && <span className="shrink-0 rounded-full bg-white/10 px-1.5 text-[10.5px] font-semibold tabular-nums text-white/70">+{toasts.length - 1}</span>}
                </motion.div>
              ) : live ? (
                <motion.div
                  key={`l${live.key}`}
                  className="absolute inset-0 flex items-center justify-center gap-2 px-3 text-[12px] font-medium"
                  initial={{ opacity: 0, filter: "blur(6px)" }}
                  animate={{ opacity: 1, filter: "blur(0px)", transition: { ...SETTLE, delay: 0.1 } }}
                  exit={{ opacity: 0, filter: "blur(4px)", transition: { duration: 0.12 } }}
                >
                  {live.icon === "spinner" ? (
                    <Loader2 size={13} className="animate-spin" style={{ color: "rgb(var(--accent-hi))" }} />
                  ) : (
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                    </span>
                  )}
                  <span className="truncate tabular-nums">{live.text}</span>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
