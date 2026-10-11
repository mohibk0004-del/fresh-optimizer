import { motion } from "framer-motion";
import { Cpu, Gauge, MemoryStick, MonitorCog, RefreshCw, Timer } from "lucide-react";
import type { LatencyReport, SystemSnapshot } from "../lib/types";
import { Dot, GlassCard } from "./GlassCard";

interface Props {
  system: SystemSnapshot | null;
  latency: LatencyReport | null;
  latencyBusy: boolean;
  onMeasure: () => void;
  highlight?: boolean;
}

const gb = (b: number) => (b / 1024 ** 3).toFixed(b >= 10 * 1024 ** 3 ? 0 : 1);

export function SystemCard({ system, latency, latencyBusy, onMeasure, highlight }: Props) {
  const p = system?.profile;
  const live = system?.live;
  const topo = p?.topology;
  const gpu = p?.gpus[0];

  return (
    <GlassCard id="system" title="System & Latency" subtitle="Hardware profile · scheduler health" icon={Cpu}
      highlight={highlight}
      delay={0.05}
      action={
        <button type="button" onClick={onMeasure} disabled={latencyBusy} className="btn-ghost">
          <RefreshCw size={12} className={latencyBusy ? "animate-spin" : ""} /> DPC test
        </button>
      }
    >
      <div className="flex flex-col gap-1.5">
        <HwRow
          icon={Cpu}
          title={p?.cpu.name || "Detecting CPU…"}
          detail={
            topo
              ? `${topo.physicalCores}C / ${topo.logicalThreads}T · ${p!.cpu.maxClockMhz ? `${(p!.cpu.maxClockMhz / 1000).toFixed(2)} GHz base` : ""}`
              : "—"
          }
          badge={topo ? (topo.hybrid ? `${topo.pCores}P + ${topo.eCores}E` : "Uniform cores") : null}
          tone={topo?.hybrid ? "warn" : "good"}
        />
        <HwRow
          icon={MonitorCog}
          title={gpu?.name || (system ? "GPU not reported" : "Detecting GPU…")}
          detail={gpu ? `${gb(gpu.vramBytes)} GB VRAM · driver ${gpu.driverVersion}` : "—"}
          badge={live ? (live.hagsEnabled === null ? "HAGS default" : live.hagsEnabled ? "HAGS on" : "HAGS off") : null}
          tone={live?.hagsEnabled ? "good" : "off"}
        />
        <HwRow
          icon={MemoryStick}
          title={p ? `${gb(p.ram.totalBytes)} GB ${p.ramType}` : "Detecting memory…"}
          detail={p ? `${p.ram.modules} module${p.ram.modules === 1 ? "" : "s"} · ${p.ram.configuredMhz} MT/s (rated ${p.ram.ratedMhz})` : "—"}
          badge={p ? (p.xmpLikely ? "XMP/EXPO active" : "JEDEC speed") : null}
          tone={p?.xmpLikely ? "good" : "warn"}
        />
      </div>

      <div className="mt-1.5 grid min-h-[62px] flex-1 grid-cols-2 gap-1.5">
        <div className="glass-inset flex items-center gap-2.5 px-3 py-1.5">
          <ScoreRing score={latency?.score ?? null} busy={latencyBusy} />
          <div className="min-w-0 flex-1">
            <div className="label flex items-center gap-1.5">
              <Gauge size={12} /> DPC / ISR
            </div>
            <div className="truncate text-[13px] font-semibold">{latency ? latency.verdict : latencyBusy ? "Measuring…" : "Not measured"}</div>
            <div className="truncate text-[11px] tabular-nums text-slate-muted">
              {latency ? `max ${latency.maxUs} µs · ${latency.over100us} >100µs` : "300 ms spin probe"}
            </div>
          </div>
        </div>

        <div className="glass-inset flex flex-col justify-center px-3 py-1.5">
          <div className="label flex items-center gap-1.5">
            <Timer size={12} /> Timer resolution
          </div>
          <div className="flex items-baseline gap-1">
            <span className={`text-xl font-semibold tabular-nums tracking-tight ${live && live.timer.currentMs <= 0.51 ? "text-success text-glow-success" : ""}`}>
              {live ? live.timer.currentMs.toFixed(live.timer.currentMs < 1 ? 2 : 3) : "—"}
            </span>
            <span className="text-xs text-slate-muted">ms</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-muted">
            <Dot tone={live?.timer.heldByApp ? "good" : "off"} />
            {live?.timer.heldByApp ? "0.5 ms held · match mode" : `Finest ${live?.timer.finestMs ?? "—"} ms · requested in-match`}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function HwRow({ icon: Icon, title, detail, badge, tone }: { icon: typeof Cpu; title: string; detail: string; badge: string | null; tone: "good" | "warn" | "off" }) {
  const badgeCls =
    tone === "good" ? "border-success/25 bg-success/10 text-success" : tone === "warn" ? "border-warn/25 bg-warn/10 text-warn" : "border-obsidian-line bg-white/[0.04] text-slate-muted";
  return (
    <div className="glass-inset flex items-center gap-3 px-3 py-1.5">
      <Icon size={16} className="shrink-0 text-slate-muted" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{title}</div>
        <div className="truncate text-[11px] tabular-nums text-slate-muted">{detail}</div>
      </div>
      {badge && <span className={`chip shrink-0 ${badgeCls}`}>{badge}</span>}
    </div>
  );
}

function ScoreRing({ score, busy }: { score: number | null; busy: boolean }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const pct = score === null ? 0 : score / 100;
  const color = score === null ? "#8F94A6" : score >= 85 ? "#00FF9D" : score >= 65 ? "#FFB020" : "#FF1E27";
  return (
    <div className="relative grid h-[46px] w-[46px] shrink-0 place-items-center">
      <svg viewBox="0 0 56 56" className={`absolute inset-0 -rotate-90 ${busy ? "animate-spin [animation-duration:1.4s]" : ""}`}>
        <circle cx="28" cy="28" r={r} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="5" />
        <motion.circle
          cx="28"
          cy="28"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: busy ? c * 0.75 : c * (1 - pct) }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 2px ${color}66)` }}
        />
      </svg>
      <span className="text-sm font-bold tabular-nums">{busy ? "" : (score ?? "—")}</span>
    </div>
  );
}
