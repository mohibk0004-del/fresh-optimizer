import { History, Loader2, RotateCcw, X } from "lucide-react";
import { Sheet } from "./Sheet";
import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "../lib/api";
import { tweakName } from "../lib/copy";
import type { Boost, ToastKind } from "../lib/hooks";
import type { HistoryRow } from "../lib/types";

const OTHER: Record<string, string> = {
  dns: "DNS server",
  startup: "Startup apps",
  nic_manual: "Network card settings",
};

interface Props {
  open: boolean;
  onClose: () => void;
  boost: Boost;
  onUndoAll: () => void;
  notify: (k: ToastKind, t: string) => void;
}

/** Every change FreshOptimizer made, what it was before, and a per-change Undo. */
export function HistorySheet({ open, onClose, boost, onUndoAll, notify }: Props) {
  return (
    <Sheet open={open} onClose={onClose} label={"Change history"} width={540} className="overflow-hidden">
      <Body onClose={onClose} boost={boost} onUndoAll={onUndoAll} notify={notify} />
    </Sheet>
  );
}

function Body({ onClose, boost, onUndoAll, notify }: Omit<Props, "open">) {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const read = () => api.restoreEntries().then(setRows).catch((e) => notify("error", errorText(e)));
  useEffect(() => {
    read();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const groups = useMemo(() => {
    const m = new Map<string, HistoryRow[]>();
    for (const r of rows ?? []) m.set(r.tweak, [...(m.get(r.tweak) ?? []), r]);
    return [...m.entries()].reverse();
  }, [rows]);

  const name = (id: string) => OTHER[id] ?? tweakName(id, boost.tweaks.find((t) => t.id === id)?.name ?? id);

  const undo = async (id: string) => {
    setBusy(id);
    await boost.undoOne(id);
    await read();
    setBusy(null);
  };

  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[16px] font-semibold">
          <History size={16} className="text-crimson" /> Change history
        </div>
        <button type="button" className="grid h-7 w-7 place-items-center rounded-full text-slate-muted hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close">
          <X size={15} />
        </button>
      </div>
      <p className="mb-4 text-[12px] text-slate-muted">Everything FreshOptimizer changed, with the value it had before. Undo one change, or all of them.</p>

      <div className="-mr-2 min-h-0 flex-1 space-y-2 overflow-y-auto pr-2">
        {rows === null ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-slate-muted">
            <Loader2 size={15} className="animate-spin" /> Reading…
          </div>
        ) : groups.length === 0 ? (
          <p className="glass-inset px-3 py-6 text-center text-[12.5px] text-slate-muted">Nothing has been changed. Your PC is exactly as it was.</p>
        ) : (
          groups.map(([id, list]) => (
            <section key={id} className="glass-inset px-3 py-2.5">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 text-[13px] font-semibold">{name(id)}</div>
                <button type="button" className="btn-ghost shrink-0" disabled={!!busy || boost.phase !== "idle"} onClick={() => undo(id)}>
                  {busy === id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Undo
                </button>
              </div>
              <ul className="mt-1.5 space-y-1">
                {list.map((r, i) => (
                  <li key={i} className="text-[11.5px]">
                    <div className="truncate font-mono text-[10.5px] text-slate-muted" title={r.what}>
                      {r.what}
                    </div>
                    <div className="tabular-nums">
                      <span className="text-slate-muted">{r.before}</span> → <span>{r.now}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {groups.length > 0 && (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-white/[0.06] pt-3">
          <p className="text-[11.5px] text-slate-muted">Linked changes (like the power plan) are undone together.</p>
          <button type="button" className="btn-ghost shrink-0" disabled={boost.phase !== "idle"} onClick={onUndoAll}>
            <RotateCcw size={12} /> Undo all
          </button>
        </div>
      )}
    </div>
  );
}
