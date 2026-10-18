import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpRight, CheckCircle2, CircleAlert, Download, Lightbulb, Loader2, RefreshCw, Wifi, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import type { ToastKind } from "../lib/hooks";
import type { HealthItem, PcChecks } from "../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  goTo: (page: string) => void;
  notify: (k: ToastKind, t: string) => void;
}

/** One button, every check: a short to-do list, most important first. Read-only. */
export function HealthSheet({ open, onClose, goTo, notify }: Props) {
  return (
    <AnimatePresence>
      {open && (
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
            aria-label="Health check"
            className="glass-card m-3 mt-12 flex w-[500px] flex-col overflow-y-auto !rounded-[20px] !bg-void-800/95 p-5"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            onClick={(e) => e.stopPropagation()}
          >
            <Body onClose={onClose} goTo={goTo} notify={notify} />
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Body({ onClose, goTo, notify }: Omit<Props, "open">) {
  const [checks, setChecks] = useState<PcChecks | null>(null);
  const [busy, setBusy] = useState(true);
  const closeBtn = useRef<HTMLButtonElement>(null);

  const run = async () => {
    setBusy(true);
    try {
      setChecks(await api.healthCheck());
    } catch (e) {
      notify("error", errorText(e));
    }
    setBusy(false);
  };
  useEffect(() => {
    run();
    closeBtn.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (i: HealthItem) => {
    if (!i.go) return;
    if (i.go.startsWith("ms-settings:")) api.openSettings(i.go).catch((e) => notify("error", errorText(e)));
    else {
      goTo(i.go);
      onClose();
    }
  };

  const groups: [HealthItem["level"], string][] = [
    ["fix", "Fix now"],
    ["worth", "Worth doing"],
    ["fine", "Looking good"],
  ];

  return (
    <div className="relative z-10">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[16px] font-semibold">Health check</div>
        <div className="flex items-center gap-1">
          <button type="button" className="btn-ghost" onClick={run} disabled={busy}>
            <RefreshCw size={12} className={busy ? "animate-spin" : ""} /> Check again
          </button>
          <button ref={closeBtn} type="button" className="grid h-7 w-7 place-items-center rounded-full text-slate-muted hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>
      </div>
      <p className="mb-4 text-[12px] text-slate-muted">Reads your PC, network, drivers and game settings. Nothing is changed.</p>

      {busy && !checks ? (
        <div className="flex items-center gap-2 py-10 text-[13px] text-slate-muted">
          <Loader2 size={15} className="animate-spin" /> Checking everything…
        </div>
      ) : checks ? (
        <div className="space-y-4">
          {groups.map(([level, title]) => {
            const items = checks.items.filter((i) => i.level === level);
            if (!items.length) return null;
            return (
              <section key={level}>
                <div className="label mb-2">{title}</div>
                <ul className="space-y-1.5">
                  {items.map((i, n) => (
                    <li key={i.id + n} className="glass-inset flex items-start gap-3 px-3 py-2.5">
                      {level === "fix" ? (
                        <CircleAlert size={16} className="mt-0.5 shrink-0 text-warn" />
                      ) : level === "worth" ? (
                        <Lightbulb size={16} className="mt-0.5 shrink-0 text-white/60" />
                      ) : (
                        <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium">{i.title}</div>
                        {i.detail && <p className="mt-0.5 text-[11.5px] leading-relaxed text-slate-muted">{i.detail}</p>}
                      </div>
                      {i.go && level !== "fine" && (
                        <button type="button" className="btn-ghost shrink-0" onClick={() => go(i)}>
                          <ArrowUpRight size={12} /> Go
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          <section>
            <div className="label mb-2">Details</div>
            <div className="glass-inset space-y-2 px-3 py-2.5 text-[12px]">
              <div className="flex items-start gap-2">
                <Wifi size={13} className="mt-0.5 shrink-0 text-slate-muted" />
                <span className="w-[70px] shrink-0 text-slate-muted">Network</span>
                <span className="min-w-0 flex-1">
                  {checks.wifi
                    ? `Wi-Fi "${checks.wifi.ssid}" · ${checks.wifi.signalPct}% signal · ${checks.wifi.band ?? "band unknown"}${checks.wifi.channel ? ` (channel ${checks.wifi.channel})` : ""} · ${checks.wifi.standard} · ${checks.wifi.linkMbps} Mbps link`
                    : checks.wired
                      ? "Wired (cable). The best choice for games."
                      : "Couldn't tell how you're connected."}
                </span>
              </div>
              {checks.driver && (
                <div className="flex items-start gap-2">
                  <Download size={13} className="mt-0.5 shrink-0 text-slate-muted" />
                  <span className="w-[70px] shrink-0 text-slate-muted">Driver</span>
                  <span className="min-w-0 flex-1">
                    {checks.driver.gpu} · {checks.driver.retail ?? checks.driver.version}
                    {checks.driver.date ? ` · released ${checks.driver.date}` : ""}
                    {checks.driver.ageDays !== null ? ` (${checks.driver.ageDays} days ago)` : ""}
                    {checks.driver.downloadUrl && (
                      <button type="button" className="ml-2 text-crimson-400 underline-offset-2 hover:underline" onClick={() => api.openDriverPage().catch((e) => notify("error", errorText(e)))}>
                        Official {checks.driver.vendor} drivers
                      </button>
                    )}
                  </span>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
