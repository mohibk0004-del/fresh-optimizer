import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown, Copy, Lightbulb, Loader2, RefreshCw, Route, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "../lib/api";
import { diagnose, reportText, ZONE_LABEL, zoneOf } from "../lib/diagnose";
import type { PingStats, Trace } from "../lib/types";
import { Word } from "./ui";

interface Props {
  target: PingStats | null;
  onClose: () => void;
}

/** Why a route looks the way it does, and what to do about it. Runs a trace on open. */
export function RouteSheet({ target, onClose }: Props) {
  return (
    <AnimatePresence>
      {target && (
        <motion.div
          className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={`Route details for ${target.label}`}
            className="glass-card m-3 mt-12 flex w-[460px] flex-col !rounded-[20px] !bg-void-800/95 p-5"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Body target={target} onClose={onClose} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Body({ target, onClose }: { target: PingStats; onClose: () => void }) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [tracing, setTracing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showHops, setShowHops] = useState(false);
  const [copied, setCopied] = useState(false);

  const run = async () => {
    setTracing(true);
    setError(null);
    try {
      setTrace(await api.traceRoute(target.host));
    } catch (e) {
      setError(errorText(e));
    }
    setTracing(false);
  };

  useEffect(() => {
    run();
    // One trace per open; "Trace again" re-runs it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.host]);

  const d = useMemo(() => diagnose(target, trace), [target, trace]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(target, trace, d));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <header className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-crimson-line bg-crimson/10 text-crimson-400">
          <Route size={17} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold leading-tight">{target.label}</h2>
          <p className="mt-0.5 truncate text-[12px] text-slate-muted">
            {target.resolved ?? target.host} · {target.received ? `${target.avgMs.toFixed(0)} ms · ±${target.jitterMs.toFixed(1)} ms · ${target.lossPct.toFixed(0)}% lost` : "no reply to pings"}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-slate-muted transition hover:bg-white/[0.06] hover:text-white active:scale-95">
          <X size={16} />
        </button>
      </header>

      <div className="-mr-2 mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-2">
        {tracing && !trace ? (
          <div className="glass-inset flex items-center gap-3 px-4 py-4 text-[13px] text-slate-muted">
            <Loader2 size={16} className="animate-spin text-crimson-400" /> Tracing the route, hop by hop. This takes a few seconds…
          </div>
        ) : (
          <>
            <section className="glass-inset px-4 py-3.5">
              <div className="text-[15px] font-semibold">
                <Word tone={d.tone}>{d.headline}</Word>
              </div>
              <ul className="mt-2 space-y-1.5 text-[12.5px] leading-relaxed text-white/80">
                {d.why.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              {error && <p className="mt-2 text-[12px] text-crimson-400">Trace failed: {error}</p>}
            </section>

            <section>
              <div className="label mb-2 flex items-center gap-1.5">
                <Lightbulb size={12} /> What you can do
              </div>
              <ol className="space-y-2">
                {d.fixes.map((f, i) => (
                  <li key={f} className="flex gap-2.5 text-[12.5px] leading-relaxed">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/[0.06] text-[11px] font-semibold text-white/70">{i + 1}</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ol>
            </section>

            <p className="rounded-xl border border-obsidian-line bg-black/20 px-3.5 py-2.5 text-[11.5px] leading-relaxed text-slate-muted">{d.aboutTarget}</p>

            {trace && trace.hops.length > 0 && (
              <section>
                <button type="button" onClick={() => setShowHops((v) => !v)} className="label flex w-full items-center gap-1.5 text-left hover:text-white">
                  <ChevronDown size={12} className={`transition-transform ${showHops ? "rotate-180" : ""}`} /> Route, hop by hop ({trace.hops.length})
                </button>
                <AnimatePresence initial={false}>
                  {showHops && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <Hops trace={trace} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            )}
          </>
        )}
      </div>

      <footer className="mt-4 flex gap-2">
        <button type="button" className="btn-ghost" onClick={run} disabled={tracing}>
          <RefreshCw size={12} className={tracing ? "animate-spin" : ""} /> {tracing ? "Tracing…" : "Trace again"}
        </button>
        <button type="button" className="btn-ghost" onClick={copy} disabled={tracing || !trace}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy report"}
        </button>
      </footer>
    </div>
  );
}

function Hops({ trace }: { trace: Trace }) {
  const max = Math.max(10, ...trace.hops.map((h) => h.worstMs ?? 0));
  let lastZone = "";
  return (
    <ul className="mt-2 space-y-1">
      {trace.hops.map((h, i) => {
        const zone = zoneOf(h, i, trace.hops);
        const header = zone !== lastZone ? ZONE_LABEL[zone] : null;
        lastZone = zone;
        return (
          <li key={h.ttl}>
            {header && <div className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-muted">{header}</div>}
            <div className="flex items-center gap-2.5 py-1 text-[12px] tabular-nums">
              <span className="w-5 shrink-0 text-right text-slate-muted">{h.ttl}</span>
              <span className={`w-[118px] shrink-0 truncate ${h.address ? "" : "text-slate-muted"}`} title={h.address ?? undefined}>
                {h.address ?? "no reply"}
              </span>
              <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.05]">
                {h.avgMs !== null && (
                  <span
                    className="absolute inset-y-0 left-0 rounded-full"
                    style={{ width: `${Math.max(3, (h.avgMs / max) * 100)}%`, background: h.lossPct >= 5 && !h.isDestination ? "rgba(255,255,255,0.25)" : "rgb(var(--accent))" }}
                  />
                )}
              </span>
              <span className="w-[54px] shrink-0 text-right">{h.avgMs !== null ? `${h.avgMs.toFixed(0)} ms` : "–"}</span>
              <span className={`w-[38px] shrink-0 text-right ${h.lossPct >= 5 && h.address ? "text-warn" : "text-slate-muted"}`}>{h.address ? `${h.lossPct.toFixed(0)}%` : ""}</span>
            </div>
          </li>
        );
      })}
      <li className="pt-2 text-[11px] leading-relaxed text-slate-muted">"No reply" hops are routers that ignore traces. That's normal and doesn't slow anything down.</li>
    </ul>
  );
}
