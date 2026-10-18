import { Cpu, Gauge, Thermometer, Trash2, Wifi } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { api, errorText, onMatchReport } from "../lib/api";
import type { ToastKind } from "../lib/hooks";
import type { MatchReport } from "../lib/types";

/** One plain-language line per measured thing. Nothing unmeasured is shown. */
export function reportHeadline(r: MatchReport): string {
  const parts: string[] = [];
  if (r.fps) parts.push(`${Math.round(r.fps.avgFps)} FPS average`);
  if (r.server?.answersPing && r.server.avgMs !== null) parts.push(`${Math.round(r.server.avgMs)} ms to the server`);
  if (r.gpu && r.gpu.thermalPct >= 5) parts.push(`GPU slowed down from heat ${Math.round(r.gpu.thermalPct)}% of the time`);
  return parts.length ? parts.join(", ") : `${Math.round(r.seconds / 60)} minutes played`;
}

export function MatchReports({ notify }: { notify: (k: ToastKind, t: string, title?: string) => void }) {
  const [reports, setReports] = useState<MatchReport[] | null>(null);
  const read = useCallback(() => api.matchReports().then(setReports).catch(() => setReports([])), []);
  useEffect(() => {
    read();
    let off: (() => void) | undefined;
    onMatchReport(() => read()).then((f) => (off = f));
    return () => off?.();
  }, [read]);

  if (!reports?.length) return null;

  const clear = async () => {
    try {
      await api.clearMatchReports();
      setReports([]);
    } catch (e) {
      notify("error", errorText(e));
    }
  };

  return (
    <div className="mb-3.5">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[13px] font-semibold">Match reports</div>
        <button type="button" className="btn-ghost" onClick={clear}>
          <Trash2 size={12} /> Clear
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3.5">
        {[...reports]
          .reverse()
          .slice(0, 6)
          .map((r) => (
            <ReportCard key={`${r.gameId}-${r.started}`} r={r} />
          ))}
      </div>
    </div>
  );
}

function ReportCard({ r }: { r: MatchReport }) {
  const when = new Date(r.started * 1000);
  return (
    <div className="glass-card p-4">
      <div className="relative z-10 flex items-baseline justify-between gap-2">
        <div className="truncate text-[14px] font-semibold">{r.game}</div>
        <div className="shrink-0 text-[11.5px] text-slate-muted">
          {when.toLocaleDateString([], { month: "short", day: "numeric" })} · {Math.round(r.seconds / 60)} min · Boost {r.boosted ? "on" : "off"}
        </div>
      </div>
      <div className="relative z-10 mt-3 space-y-2 text-[12px]">
        <Row icon={Gauge} label="Frames">
          {r.fps ? (
            <>
              <b className="tabular-nums">{Math.round(r.fps.avgFps)}</b> avg · <span className="tabular-nums">{Math.round(r.fps.low1Fps)}</span> 1% low ·{" "}
              <span className="tabular-nums">{(r.fps.stutters / Math.max(1, r.fps.seconds / 60)).toFixed(1)}</span> stutters/min
            </>
          ) : (
            <span className="text-slate-muted">Not measured (turn on FPS measurement)</span>
          )}
        </Row>
        <Row icon={Wifi} label="Server">
          {!r.server ? (
            <span className="text-slate-muted">Not found</span>
          ) : r.server.answersPing && r.server.avgMs !== null ? (
            <>
              <b className="tabular-nums">{Math.round(r.server.avgMs)} ms</b> avg · ±{r.server.jitterMs?.toFixed(1)} ms · {r.server.lossPct?.toFixed(1)}% no reply
            </>
          ) : (
            <span className="text-slate-muted">{r.server.ip} doesn't answer pings</span>
          )}
        </Row>
        <Row icon={Thermometer} label="GPU">
          {r.gpu ? (
            <>
              <b className="tabular-nums">{r.gpu.maxTempC}°C</b> max ·{" "}
              {r.gpu.thermalPct >= 5 ? (
                <span className="text-warn">slowed by heat {Math.round(r.gpu.thermalPct)}% of the time</span>
              ) : (
                <span>no heat slowdown</span>
              )}
            </>
          ) : (
            <span className="text-slate-muted">Only measured on NVIDIA cards</span>
          )}
        </Row>
        <Row icon={Cpu} label="Background">
          {r.hogs.length ? (
            <span className="text-warn">
              {r.hogs
                .slice(0, 2)
                .map((h) => `${h.exe} (${Math.round(h.maxCpuPct)}% CPU)`)
                .join(", ")}
            </span>
          ) : (
            <span>Nothing busy</span>
          )}
        </Row>
      </div>
    </div>
  );
}

function Row({ icon: Icon, label, children }: { icon: typeof Cpu; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={13} className="mt-0.5 shrink-0 text-slate-muted" />
      <span className="w-[74px] shrink-0 text-slate-muted">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}
