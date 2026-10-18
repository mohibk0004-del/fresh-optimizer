import { ArrowDownWideNarrow, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorText } from "../lib/api";
import type { ToastKind } from "../lib/hooks";
import type { Hog } from "../lib/types";

/** Programs busy in the background while a game runs, with gentle fixes. */
export function HogList({ initial, notify }: { initial: Hog[]; notify: (k: ToastKind, t: string) => void }) {
  const [hogs, setHogs] = useState<Hog[]>(initial);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    setHogs(initial);
  }, [initial]);
  useEffect(() => {
    const id = window.setInterval(() => api.engineStatus().then((s) => setHogs(s.hogs)).catch(() => {}), 3000);
    return () => window.clearInterval(id);
  }, []);

  const act = async (h: Hog, kind: "lower" | "close") => {
    setBusy(h.pid);
    try {
      if (kind === "lower") {
        await api.hogLower(h.pid);
        setHogs((x) => x.map((y) => (y.pid === h.pid ? { ...y, lowered: true } : y)));
        notify("success", `${h.exe} now runs at low priority until your game closes.`);
      } else {
        await api.hogClose(h.pid);
        notify("info", `Asked ${h.exe} to close.`);
      }
    } catch (e) {
      notify("error", errorText(e));
    }
    setBusy(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="mb-2 text-[12px] leading-relaxed text-slate-muted">
        These are busy while you play. Lower priority lets your game go first and is undone when the game closes. Close asks the app to quit the normal way, so it may ask you to
        save first.
      </p>
      <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
        {hogs.map((h) => (
          <li key={h.pid} className="glass-inset flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-semibold">{h.exe}</div>
              <div className="text-[11.5px] text-slate-muted">
                {h.cpuPct >= 1 ? `${h.cpuPct.toFixed(0)}% CPU` : ""}
                {h.cpuPct >= 1 && h.diskMbps >= 1 ? " · " : ""}
                {h.diskMbps >= 1 ? `${h.diskMbps.toFixed(0)} MB/s disk` : ""}
                {h.lowered ? " · low priority" : ""}
                {h.protected ? " · part of Windows, left alone" : ""}
              </div>
            </div>
            {!h.protected && (
              <>
                {!h.lowered && (
                  <button type="button" className="btn-ghost" disabled={busy === h.pid} onClick={() => act(h, "lower")}>
                    <ArrowDownWideNarrow size={12} /> Lower
                  </button>
                )}
                <button type="button" className="btn-ghost" disabled={busy === h.pid} onClick={() => act(h, "close")}>
                  <X size={12} /> Close
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
