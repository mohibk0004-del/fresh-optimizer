import { AlertTriangle, History, RotateCcw } from "lucide-react";
import { Switch, StatusText } from "../components/ui";
import { GROUPS, TWEAK_COPY } from "../lib/copy";
import type { Boost } from "../lib/hooks";

export function TweaksPage({ boost, onUndo }: { boost: Boost; onUndo: () => void }) {
  const locked = boost.phase !== "idle";
  const restoreOk = !!boost.restore?.exists;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <p className="text-[13px] text-slate-muted">
          {locked ? "Pause Boost to change these." : `${boost.enabled.size} of ${boost.tweaks.length} turned on. Hover a tweak to see the exact Windows setting.`}
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" disabled={locked} onClick={boost.resetRecommended}>
            <RotateCcw size={13} /> Use recommended
          </button>
          <button type="button" className="btn-ghost" disabled={!restoreOk || boost.phase === "boosting"} onClick={onUndo}>
            <History size={13} /> Undo all changes
          </button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-2 content-start gap-3.5 overflow-y-auto pb-1 pr-1">
        {GROUPS.map((g) => {
          const items = boost.tweaks.filter((t) => g.cats.includes(t.category));
          return (
            <section key={g.id} className="glass-card flex flex-col p-4">
              <header className="relative z-10 mb-2">
                <h2 className="text-[15px] font-semibold">{g.title}</h2>
                <p className="text-[12px] text-slate-muted">{g.blurb}</p>
              </header>
              <ul className="relative z-10 divide-y divide-white/[0.05]">
                {items.map((t) => {
                  const copy = TWEAK_COPY[t.id];
                  const row = boost.tasks[t.id];
                  const on = boost.enabled.has(t.id);
                  return (
                    <li key={t.id} className="flex items-start gap-3 py-2.5" title={`${t.name}: ${t.description}${row?.detail ? `\n\nResult: ${row.detail}` : ""}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[13px] font-medium">
                          {copy?.name ?? t.name}
                          {t.caution && <AlertTriangle size={12} className="shrink-0 text-warn" aria-label={t.caution} />}
                          <StatusText state={row?.state ?? "idle"} detail={row?.detail} />
                        </div>
                        <p className="mt-0.5 text-[12px] leading-relaxed text-slate-muted">{copy?.what ?? t.description}</p>
                        {row?.state === "failed" && row.detail && <p className="mt-1 text-[11px] text-crimson-400">{row.detail}</p>}
                      </div>
                      <Switch on={on} disabled={locked} onChange={() => boost.toggle(t.id)} label={copy?.name ?? t.name} />
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
