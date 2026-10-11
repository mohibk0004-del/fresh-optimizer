import { Cpu, Gauge, MemoryStick, MonitorCog, RefreshCw, Settings2, Timer } from "lucide-react";
import { GlassCard } from "../components/GlassCard";
import { Word } from "../components/ui";
import { smoothWord, type Tone } from "../lib/copy";
import type { AppData } from "../lib/useAppData";

const gb = (b: number) => (b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1);

export function PcPage({ data }: { data: AppData }) {
  const p = data.system?.profile;
  const live = data.system?.live;
  const topo = p?.topology;
  const gpu = p?.gpus[0];
  const smooth = smoothWord(data.latency?.score ?? null);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto] gap-3.5">
      <GlassCard title="Your hardware" subtitle="What FreshOptimizer is tuning for" icon={Cpu} className="row-span-2">
        <div className="flex flex-col gap-2">
          <Part
            icon={Cpu}
            kind="Processor"
            name={p?.cpu.name || "Reading…"}
            detail={topo ? `${topo.physicalCores} cores, ${topo.logicalThreads} threads${topo.hybrid ? ` · ${topo.pCores} fast + ${topo.eCores} efficient cores` : ""}` : ""}
            badge={topo?.hybrid ? ["Hybrid CPU", "warn"] : topo ? ["All cores equal", "good"] : null}
          />
          <Part
            icon={MonitorCog}
            kind="Graphics"
            name={gpu?.name || (p ? "Not reported" : "Reading…")}
            detail={gpu ? `${gb(gpu.vramBytes)} GB video memory · driver ${gpu.driverVersion}` : ""}
            badge={null}
          />
          <Part
            icon={MemoryStick}
            kind="Memory"
            name={p ? `${gb(p.ram.totalBytes)} GB ${p.ramType}` : "Reading…"}
            detail={p ? `Running at ${p.ram.configuredMhz} MT/s (rated ${p.ram.ratedMhz})` : ""}
            badge={p ? (p.xmpLikely ? ["XMP / EXPO on", "good"] : ["XMP / EXPO looks off", "warn"]) : null}
          />
          {p && !p.xmpLikely && (
            <p className="rounded-xl border border-warn/20 bg-warn/[0.06] px-3.5 py-2.5 text-[12px] leading-relaxed text-warn/90">
              Your memory may be running below its rated speed. Turning on XMP (Intel) or EXPO (AMD) in your BIOS is often a free FPS boost.
            </p>
          )}
        </div>

        <div className="mt-auto pt-4">
          <div className="label mb-2 flex items-center gap-1.5">
            <Settings2 size={12} /> Windows gaming settings
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Flag label="Game Mode" on={live?.gameModeEnabled} goodWhen />
            <Flag label="Background recording" on={live?.gameDvrEnabled} goodWhen={false} />
            <Flag label="GPU scheduling" on={live?.hagsEnabled ?? undefined} goodWhen neutralIfUnknown />
          </div>
        </div>
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
          <div>
            <div className="text-[22px] font-bold tracking-tight">
              <Word tone={data.latencyBusy ? "off" : smooth.tone}>{data.latencyBusy ? "Testing…" : smooth.word}</Word>
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-slate-muted">
              {data.latency
                ? data.latency.over100us === 0
                  ? `Longest interruption was ${Math.round(data.latency.maxUs)} µs. That's great: no driver is holding up your games.`
                  : `${data.latency.over100us} interruptions over 100 µs. A driver (often Wi-Fi, audio or RGB software) may cause stutter.`
                : "Spins one CPU core for 0.3 seconds and watches for anything that steals it."}
            </p>
          </div>
        </div>
      </GlassCard>

      <GlassCard title="System clock" subtitle="How often Windows checks in on your game" icon={Timer}>
        <div className="flex items-baseline gap-2">
          <span className="text-[28px] font-bold tabular-nums tracking-tight">{live ? live.timer.currentMs.toFixed(live.timer.currentMs < 1 ? 2 : 1) : "—"}</span>
          <span className="text-[13px] text-slate-muted">ms</span>
          {live?.timer.heldByApp && <span className="chip ml-2 border-success/25 text-success">Sharpened for your match</span>}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-muted">
          Lower is snappier. FreshOptimizer sets this to 0.5 ms only while you're in a game, then lets it go so your PC can save power.
        </p>
      </GlassCard>
    </div>
  );
}

function Part({ icon: Icon, kind, name, detail, badge }: { icon: typeof Cpu; kind: string; name: string; detail: string; badge: [string, Tone] | null }) {
  const cls = badge?.[1] === "good" ? "border-success/25 text-success" : "border-warn/30 text-warn";
  return (
    <div className="glass-inset flex items-center gap-3.5 px-3.5 py-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-obsidian-line bg-white/[0.04] text-slate-muted">
        <Icon size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] text-slate-muted">{kind}</div>
        <div className="truncate text-[14px] font-semibold">{name}</div>
        <div className="truncate text-[12px] text-slate-muted">{detail}</div>
      </div>
      {badge && <span className={`chip shrink-0 ${cls}`}>{badge[0]}</span>}
    </div>
  );
}

function Flag({ label, on, goodWhen, neutralIfUnknown }: { label: string; on: boolean | undefined; goodWhen: boolean; neutralIfUnknown?: boolean }) {
  const unknown = on === undefined;
  const good = !unknown && on === goodWhen;
  return (
    <div className="glass-inset px-3 py-2.5">
      <div className="truncate text-[11px] text-slate-muted">{label}</div>
      <div className={`mt-0.5 text-[13px] font-semibold ${unknown ? "text-slate-muted" : good ? "text-success" : "text-warn"}`}>
        {unknown ? (neutralIfUnknown ? "Default" : "—") : on ? "On" : "Off"}
      </div>
    </div>
  );
}

function ScoreRing({ score, busy }: { score: number | null; busy: boolean }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = score === null ? "#8F94A6" : score >= 65 ? "#00FF9D" : score >= 40 ? "#FFB020" : "#FF1E27";
  return (
    <div className="relative grid h-[84px] w-[84px] shrink-0 place-items-center">
      <svg viewBox="0 0 80 80" className={`absolute inset-0 -rotate-90 ${busy ? "animate-spin [animation-duration:1.4s]" : ""}`}>
        <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={busy ? c * 0.75 : c * (1 - (score ?? 0) / 100)}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <span className="text-[20px] font-bold tabular-nums">{busy ? "" : (score ?? "—")}</span>
    </div>
  );
}
