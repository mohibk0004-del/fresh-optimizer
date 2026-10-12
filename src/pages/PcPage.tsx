import { ArrowUpRight, Cpu, Gauge, MemoryStick, MonitorCog, Power, RefreshCw, Rocket, Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "../components/GlassCard";
import { Switch, Word } from "../components/ui";
import { api, errorText } from "../lib/api";
import { smoothWord, type Tone } from "../lib/copy";
import type { ToastKind } from "../lib/hooks";
import type { StartupItem, TimerInfo, TimerMode } from "../lib/types";
import { Segmented } from "./GamesPage";
import type { AppData } from "../lib/useAppData";

const gb = (b: number) => (b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1);

export function PcPage({ data, notify }: { data: AppData; notify: (k: ToastKind, t: string) => void }) {
  const p = data.system?.profile;
  const live = data.system?.live;
  const topo = p?.topology;
  const gpu = p?.gpus[0];
  const smooth = smoothWord(data.latency?.score ?? null);

  const [apps, setApps] = useState<StartupItem[] | null>(null);
  const [filter, setFilter] = useState<"on" | "all">("on");
  useEffect(() => {
    api.startupApps().then(setApps).catch(() => setApps([]));
  }, []);

  const toggleApp = async (it: StartupItem) => {
    const enabled = !it.enabled;
    setApps((a) => a?.map((x) => (x.source === it.source && x.name === it.name ? { ...x, enabled } : x)) ?? null);
    try {
      await api.setStartup(it.source, it.name, enabled);
    } catch (e) {
      setApps((a) => a?.map((x) => (x.source === it.source && x.name === it.name ? { ...x, enabled: !enabled } : x)) ?? null);
      notify("error", `Couldn't change ${it.display}: ${errorText(e)}`);
    }
  };

  const onCount = apps?.filter((a) => a.enabled).length ?? 0;
  const shown = useMemo(() => (apps ?? []).filter((a) => filter === "all" || a.enabled), [apps, filter]);
  const open = (page: string) => api.openSettings(page).catch((e) => notify("error", errorText(e)));

  return (
    <div className="grid min-h-0 flex-1 grid-cols-3 grid-rows-[auto_minmax(0,1fr)] gap-3.5">
      <GlassCard title="Your hardware" subtitle="What FreshOptimizer tunes for" icon={Cpu}>
        <div className="flex flex-col gap-1.5">
          <Part
            icon={Cpu}
            name={p?.cpu.name || "Reading…"}
            detail={topo ? `${topo.physicalCores} cores, ${topo.logicalThreads} threads${topo.hybrid ? ` · ${topo.pCores} fast + ${topo.eCores} efficient` : ""}` : ""}
            badge={topo?.hybrid ? ["Hybrid", "warn"] : null}
          />
          <Part icon={MonitorCog} name={gpu?.name || (p ? "Graphics not reported" : "Reading…")} detail={gpu ? `${gb(gpu.vramBytes)} GB video memory` : ""} badge={null} />
          <Part
            icon={MemoryStick}
            name={p ? `${gb(p.ram.totalBytes)} GB ${p.ramType}` : "Reading…"}
            detail={p ? `${p.ram.configuredMhz} MT/s (rated ${p.ram.ratedMhz})` : ""}
            badge={p ? (p.xmpLikely ? ["XMP on", "good"] : ["XMP off?", "warn"]) : null}
          />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-1.5">
          <SettingTile label="Game Mode" value={live ? (live.gameModeEnabled ? "On" : "Off") : "—"} good={live?.gameModeEnabled} onClick={() => open("ms-settings:gaming-gamemode")} />
          <SettingTile label="Background recording" value={live ? (live.gameDvrEnabled ? "On" : "Off") : "—"} good={live ? !live.gameDvrEnabled : undefined} onClick={() => open("ms-settings:gaming-gamebar")} />
          <SettingTile
            label="GPU scheduling"
            value={live ? (live.hagsEnabled === null ? "Default" : live.hagsEnabled ? "On" : "Off") : "—"}
            good={live?.hagsEnabled ?? undefined}
            onClick={() => open("ms-settings:display-advancedgraphics")}
          />
        </div>
        {p && !p.xmpLikely && (
          <p className="mt-2 text-[11.5px] leading-relaxed text-warn/90">Memory may be below its rated speed. Turning on XMP/EXPO in your BIOS is often a free FPS boost.</p>
        )}
      </GlassCard>

      <GlassCard
        title="Smoothness test"
        subtitle="Do drivers interrupt your CPU?"
        icon={Gauge}
        action={
          <button type="button" className="btn-ghost" onClick={data.measure} disabled={data.latencyBusy}>
            <RefreshCw size={12} className={data.latencyBusy ? "animate-spin" : ""} /> {data.latencyBusy ? "Testing…" : "Test again"}
          </button>
        }
      >
        <div className="flex items-center gap-5">
          <ScoreRing score={data.latency?.score ?? null} busy={data.latencyBusy} />
          <div className="min-w-0">
            <div className="text-[20px] font-bold tracking-tight">
              <Word tone={data.latencyBusy ? "off" : smooth.tone}>{data.latencyBusy ? "Testing…" : smooth.word}</Word>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-muted">
              {data.latencyBusy
                ? "Watching one CPU core for about 4 seconds…"
                : data.latency
                  ? `Typical driver interruption: ${Math.round(data.latency.typicalUs)} µs. ${
                      data.latency.longStallsPerSec >= 1
                        ? "Long stalls (over 100 µs) happen often. A driver (Wi-Fi, audio or RGB software are common culprits) may cause stutter."
                        : "That's low: no driver is regularly holding up your games."
                    }`
                  : "Checks whether drivers keep interrupting your CPU, the usual cause of micro-stutter."}
            </p>
          </div>
        </div>
        {data.latency && !data.latencyBusy && (
          <div className="mt-3 space-y-1.5 text-[11.5px] leading-relaxed text-slate-muted">
            <p>
              Worst moment: {Math.round(data.latency.maxUs)} µs
              {data.latency.burstWindows > 0
                ? ` (a short burst in ${data.latency.burstWindows} of ${data.latency.windowsTotal} samples, which is normal now and then).`
                : ", with no bursts."}
            </p>
            {data.latencyHistory.length > 1 && (
              <p>
                Your last tests: <span className="tabular-nums text-white/80">{data.latencyHistory.join(", ")}</span>. Small differences are real: Windows' background
                activity changes from second to second, so no two tests are identical.
              </p>
            )}
          </div>
        )}
      </GlassCard>

      <TimerCard notify={notify} />

      <GlassCard
        title="Startup apps"
        subtitle={apps ? `${onCount} app${onCount === 1 ? "" : "s"} start with Windows. Fewer means a faster boot and less in the background.` : "Reading…"}
        icon={Rocket}
        className="col-span-3"
        action={
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-obsidian-line bg-black/30 p-0.5">
              {(
                [
                  ["on", "Turned on"],
                  ["all", "All"],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFilter(v)}
                  className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${filter === v ? "bg-crimson/90 text-white" : "text-slate-muted hover:text-white"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <button type="button" className="btn-ghost" onClick={() => open("ms-settings:startupapps")} title="Open Windows startup settings">
              <ArrowUpRight size={12} /> Windows
            </button>
          </div>
        }
      >
        <ul className="grid min-h-0 grid-cols-2 gap-x-6 overflow-y-auto pr-1">
          {shown.map((it) => (
            <li key={it.source + it.name} className="flex items-center gap-3 border-b border-white/[0.05] py-2" title={it.command}>
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-obsidian-line bg-white/[0.04] text-[11px] font-bold uppercase text-white/70">
                {it.display.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`truncate text-[13px] font-medium ${it.enabled ? "" : "text-slate-muted"}`}>{it.display}</div>
                <div className="truncate text-[11px] text-slate-muted">
                  {it.allUsers ? "All users · " : ""}
                  {it.command}
                </div>
              </div>
              <Switch on={it.enabled} onChange={() => toggleApp(it)} label={`Start ${it.display} with Windows`} />
            </li>
          ))}
          {apps && shown.length === 0 && <li className="col-span-2 py-4 text-[13px] text-slate-muted">Nothing starts with Windows. Nice and clean.</li>}
        </ul>
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-muted">
          <Power size={11} /> Uses the same switches as Task Manager. Nothing is deleted, and Undo turns them all back.
        </p>
      </GlassCard>
    </div>
  );
}

function Part({ icon: Icon, name, detail, badge }: { icon: typeof Cpu; name: string; detail: string; badge: [string, Tone] | null }) {
  const cls = badge?.[1] === "good" ? "border-success/25 text-success" : "border-warn/30 text-warn";
  return (
    <div className="glass-inset flex items-center gap-3 px-3 py-2">
      <Icon size={16} className="shrink-0 text-slate-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-semibold">{name}</div>
        <div className="truncate text-[11.5px] text-slate-muted">{detail}</div>
      </div>
      {badge && <span className={`chip shrink-0 ${cls}`}>{badge[0]}</span>}
    </div>
  );
}

function SettingTile({ label, value, good, onClick }: { label: string; value: string; good: boolean | undefined; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="glass-inset group px-3 py-2 text-left transition-colors hover:border-white/15 active:scale-[0.98]" title="Open in Windows Settings">
      <div className="flex items-center justify-between text-[11px] text-slate-muted">
        <span className="truncate">{label}</span>
        <ArrowUpRight size={11} className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
      </div>
      <div className={`mt-0.5 text-[13px] font-semibold ${good === undefined ? "text-slate-muted" : good ? "text-success" : "text-warn"}`}>{value}</div>
    </button>
  );
}

function ScoreRing({ score, busy }: { score: number | null; busy: boolean }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const color = score === null ? "#8F94A6" : score >= 65 ? "#00FF9D" : score >= 40 ? "#FFB020" : "rgb(var(--accent))";
  return (
    <div className="relative grid h-[72px] w-[72px] shrink-0 place-items-center">
      <svg viewBox="0 0 72 72" className={`absolute inset-0 -rotate-90 ${busy ? "animate-spin [animation-duration:1.4s]" : ""}`}>
        <circle cx="36" cy="36" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={busy ? c * 0.75 : c * (1 - (score ?? 0) / 100)}
          style={{ stroke: color, transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <span className="text-[18px] font-bold tabular-nums">{busy ? "" : (score ?? "—")}</span>
    </div>
  );
}

const TIMER_MODES: [TimerMode, string][] = [
  ["off", "Off"],
  ["match", "During matches"],
  ["always", "Always"],
];

/** Timer resolution control, like the standalone "TimerResolution" tools. */
function TimerCard({ notify }: { notify: (k: ToastKind, t: string) => void }) {
  const [info, setInfo] = useState<TimerInfo | null>(null);
  useEffect(() => {
    const read = () => api.getTimer().then(setInfo).catch(() => {});
    read();
    const id = window.setInterval(read, 3000);
    return () => window.clearInterval(id);
  }, []);

  const choose = async (mode: TimerMode) => {
    try {
      setInfo(await api.setTimerMode(mode));
      try {
        localStorage.setItem("fo.timerMode", mode);
      } catch {
        /* ignore */
      }
    } catch (e) {
      notify("error", errorText(e));
    }
  };

  const cur = info?.status.currentMs;
  return (
    <GlassCard title="Timer resolution" subtitle="How often Windows wakes up to schedule work" icon={Timer}>
      <div className="flex items-baseline gap-2">
        <span className="text-[28px] font-bold tabular-nums tracking-tight">{cur !== undefined ? cur.toFixed(cur < 1 ? 2 : 1) : "\u2014"}</span>
        <span className="text-[13px] text-slate-muted">ms right now</span>
      </div>
      <p className="text-[11.5px] text-slate-muted">
        {info?.status.heldByApp ? "FreshOptimizer is holding 0.5 ms." : "Windows default is 15.6 ms; other apps (browsers, games) can lower it."}
      </p>
      <div className="mt-3">
        <Segmented value={info?.mode ?? "match"} options={TIMER_MODES} onChange={(v) => choose(v as TimerMode)} />
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-slate-muted">
        {info?.mode === "always"
          ? "0.5 ms while FreshOptimizer is open, even outside games. It can tighten frame pacing, but your CPU wakes up more often, which uses a little more power and heat."
          : info?.mode === "off"
            ? "FreshOptimizer never changes the timer."
            : "0.5 ms only while a supported game is running, then back to normal so your PC can save power."}
      </p>
      {info && !info.globalAllowed && info.mode !== "off" && (
        <p className="mt-auto rounded-lg border border-warn/20 bg-warn/[0.06] px-2.5 py-2 text-[11px] leading-relaxed text-warn/90">
          On Windows 11, this only speeds up FreshOptimizer itself until you turn on <b>Sharpen the system clock</b> on the Tweaks page and restart.
        </p>
      )}
    </GlassCard>
  );
}
