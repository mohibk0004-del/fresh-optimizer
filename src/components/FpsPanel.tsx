import { Activity, Download, Loader2, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText, onFpsSession } from "../lib/api";
import type { ToastKind } from "../lib/hooks";
import type { FpsSession, FpsStatus } from "../lib/types";
import { Switch } from "./ui";

interface Props {
  measure: boolean;
  onMeasure: () => void;
  watcher: boolean;
  notify: (k: ToastKind, t: string, title?: string) => void;
}

/** Real FPS / frame-time history from Intel PresentMon, with a fair-as-possible before/after Boost view. */
export function FpsPanel({ measure, onMeasure, watcher, notify }: Props) {
  const [status, setStatus] = useState<FpsStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(() => api.fpsStatus().then(setStatus).catch(() => {}), []);
  useEffect(() => {
    read();
    const id = window.setInterval(read, 5000);
    let off: (() => void) | undefined;
    onFpsSession((s) => {
      read();
      notify("success", `${s.game}: ${Math.round(s.avgFps)} FPS average, ${Math.round(s.low1Fps)} FPS 1% low.`, "Session measured");
    }).then((f) => (off = f));
    return () => {
      window.clearInterval(id);
      off?.();
    };
  }, [read, notify]);

  const run = async (f: () => Promise<FpsStatus>, ok?: string) => {
    setBusy(true);
    try {
      setStatus(await f());
      if (ok) notify("success", ok);
    } catch (e) {
      notify("error", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  if (status === null) return <div className="glass-card h-40 animate-pulse" />;

  if (!status.installed) {
    return (
      <div className="glass-card p-5">
        <div className="relative z-10 flex items-start gap-4">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-crimson">
            <Activity size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">Measure your real FPS</div>
            <p className="mt-1 text-[12.5px] leading-relaxed text-slate-muted">
              See average FPS, 1% lows and stutters for every game session, and compare sessions before and after Boost. This uses PresentMon, Intel's free open-source
              tool (MIT licence, about 1 MB). It reads Windows' own graphics timing, so it never touches the game. We download version {status.version} from Intel's GitHub and
              check it matches the official file exactly.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(api.fpsInstall, "FPS measurement is ready. Play a game to record your first session.")}
              className="bg-accent-fill mt-3 inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition hover:brightness-110 active:scale-[0.97] disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} {busy ? "Setting up…" : "Set up FPS measurement"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3.5">
      <div className="glass-card flex items-center gap-4 p-4">
        <div className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-crimson">
          <Activity size={18} />
        </div>
        <div className="relative z-10 min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Measure every game session</div>
          <div className="text-[12px] text-slate-muted">
            {!watcher
              ? "Needs Full power for games (above) to be on, since that's what notices a game starting."
              : status.capturing.length
                ? `Measuring ${status.capturing.join(", ")} now. Results appear when you quit.`
                : "Starts when a game launches and saves a summary when you quit. Sessions under 30 seconds are skipped."}
          </div>
        </div>
        <Switch on={measure} onChange={onMeasure} label="Measure every game session" />
      </div>

      <Comparison sessions={status.sessions} />

      <div className="glass-card p-4">
        <div className="relative z-10 mb-2 flex items-center justify-between">
          <div className="text-[13px] font-semibold">Sessions</div>
          <div className="flex gap-2">
            {status.sessions.length > 0 && (
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(api.fpsClear)}>
                <Trash2 size={12} /> Clear history
              </button>
            )}
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => run(api.fpsUninstall, "PresentMon removed.")}>
              Remove PresentMon
            </button>
          </div>
        </div>
        {status.sessions.length === 0 ? (
          <p className="relative z-10 py-3 text-[12.5px] text-slate-muted">No sessions yet. Play one of your games for at least 30 seconds.</p>
        ) : (
          <table className="relative z-10 w-full text-left text-[12px]">
            <thead className="text-[11px] text-slate-muted">
              <tr>
                <th className="py-1.5 font-medium">Game</th>
                <th className="font-medium">When</th>
                <th className="font-medium">Length</th>
                <th className="text-right font-medium">Average</th>
                <th className="text-right font-medium">1% low</th>
                <th className="text-right font-medium">0.1% low</th>
                <th className="text-right font-medium">Stutters</th>
                <th className="pl-3 font-medium">Boost</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {[...status.sessions].reverse().map((s) => (
                <tr key={`${s.gameId}-${s.started}`} className="border-t border-white/[0.05]">
                  <td className="max-w-[180px] truncate py-1.5 font-medium">{s.game}</td>
                  <td className="text-slate-muted">{when(s.started)}</td>
                  <td className="text-slate-muted">{Math.round(s.seconds / 60)} min</td>
                  <td className="text-right font-semibold">{Math.round(s.avgFps)}</td>
                  <td className="text-right">{Math.round(s.low1Fps)}</td>
                  <td className="text-right">{Math.round(s.low01Fps)}</td>
                  <td className="text-right text-slate-muted">{perMin(s.stutters, s.seconds)}/min</td>
                  <td className="pl-3">{s.boosted ? <span className="text-success">On</span> : <span className="text-slate-muted">Off</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Comparison({ sessions }: { sessions: FpsSession[] }) {
  const rows = useMemo(() => {
    const byGame = new Map<string, FpsSession[]>();
    for (const s of sessions) byGame.set(s.gameId, [...(byGame.get(s.gameId) ?? []), s]);
    return [...byGame.values()]
      .map((list) => ({ game: list[0].game, before: agg(list.filter((s) => !s.boosted)), after: agg(list.filter((s) => s.boosted)) }))
      .filter((r) => r.before && r.after) as { game: string; before: Agg; after: Agg }[];
  }, [sessions]);

  if (rows.length === 0) {
    return (
      <p className="px-1 text-[12px] leading-relaxed text-slate-muted">
        Before/after Boost appears once a game has sessions both without Boost and with it. Play a game now, then press Boost and play it again.
      </p>
    );
  }

  return (
    <div className="glass-card p-4">
      <div className="relative z-10 text-[13px] font-semibold">Before and after Boost</div>
      <div className="relative z-10 mt-2 space-y-2">
        {rows.map((r) => (
          <div key={r.game} className="glass-inset grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-6 px-3 py-2 text-[12px]">
            <div className="min-w-0">
              <div className="truncate font-semibold">{r.game}</div>
              <div className="text-[11px] text-slate-muted">
                {r.before.n} session{r.before.n === 1 ? "" : "s"} before · {r.after.n} after
              </div>
            </div>
            <Delta label="Average FPS" a={r.before.avg} b={r.after.avg} />
            <Delta label="1% low" a={r.before.low1} b={r.after.low1} />
            <Delta label="Stutters/min" a={r.before.stutterRate} b={r.after.stutterRate} lowerBetter decimals={1} />
          </div>
        ))}
      </div>
      <p className="relative z-10 mt-2 text-[11px] leading-relaxed text-slate-muted">
        These are your real measurements, but maps, graphics settings, game updates and what else is running all change FPS too. Small differences (a few percent) are
        usually noise; several sessions on each side give a fairer picture.
      </p>
    </div>
  );
}

interface Agg {
  n: number;
  avg: number;
  low1: number;
  stutterRate: number;
}

function agg(list: FpsSession[]): Agg | null {
  if (!list.length) return null;
  const secs = list.reduce((t, s) => t + s.seconds, 0);
  const w = (f: (s: FpsSession) => number) => list.reduce((t, s) => t + f(s) * s.seconds, 0) / secs;
  return { n: list.length, avg: w((s) => s.avgFps), low1: w((s) => s.low1Fps), stutterRate: list.reduce((t, s) => t + s.stutters, 0) / (secs / 60) };
}

function Delta({ label, a, b, lowerBetter, decimals = 0 }: { label: string; a: number; b: number; lowerBetter?: boolean; decimals?: number }) {
  const pct = a > 0 ? ((b - a) / a) * 100 : 0;
  const better = lowerBetter ? pct < 0 : pct > 0;
  const noise = Math.abs(pct) < 3;
  return (
    <div className="text-right">
      <div className="text-[10.5px] text-slate-muted">{label}</div>
      <div className="tabular-nums">
        <span className="text-slate-muted">{a.toFixed(decimals)} → </span>
        <span className="font-semibold">{b.toFixed(decimals)}</span>{" "}
        <span className={noise ? "text-slate-muted" : better ? "text-success" : "text-warn"}>
          {pct > 0 ? "+" : ""}
          {pct.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}

function perMin(n: number, secs: number) {
  return secs > 0 ? (n / (secs / 60)).toFixed(1) : "0";
}

function when(t: number) {
  const d = new Date(t * 1000);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return `Today ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
