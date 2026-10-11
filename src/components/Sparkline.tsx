import { useId } from "react";
import type { NetSample } from "../lib/hooks";

interface Props {
  samples: NetSample[];
  capacity?: number;
  height?: number;
}

/** Live RTT area chart. Lost packets render as crimson ticks on the baseline. */
export function Sparkline({ samples, capacity = 60, height = 96 }: Props) {
  const gid = useId();
  const W = 600;
  const H = height;
  const pad = 6;
  const vals = samples.map((s) => s.rtt).filter((v): v is number => v !== null);
  const max = Math.max(20, ...vals) * 1.15;
  const step = W / (capacity - 1);
  const offset = capacity - samples.length;
  const x = (i: number) => (i + offset) * step;
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);

  // Build line segments that break on lost samples.
  const segments: string[] = [];
  let cur = "";
  samples.forEach((s, i) => {
    if (s.rtt === null) {
      if (cur) segments.push(cur);
      cur = "";
      return;
    }
    cur += `${cur ? "L" : "M"}${x(i).toFixed(1)},${y(s.rtt).toFixed(1)}`;
  });
  if (cur) segments.push(cur);

  const area = segments.map((d) => {
    const pts = d.slice(1).split(/[ML]/);
    const first = pts[0].split(",")[0];
    const last = pts[pts.length - 1].split(",")[0];
    return `${d}L${last},${H}L${first},${H}Z`;
  });

  const lastIdx = samples.length - 1;
  const last = samples[lastIdx];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full" role="img" aria-label="Live ping graph">
      <defs>
        <linearGradient id={`${gid}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "rgb(var(--accent))", stopOpacity: 0.2 }} />
          <stop offset="1" style={{ stopColor: "rgb(var(--accent))", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.05)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
      ))}
      {area.map((d, i) => (
        <path key={`a${i}`} d={d} fill={`url(#${gid}-fill)`} />
      ))}
      {segments.map((d, i) => (
        <path key={`l${i}`} d={d} fill="none" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ stroke: "rgb(var(--accent-hi))", filter: "drop-shadow(0 0 2px rgb(var(--accent) / 0.3))" }} />
      ))}
      {samples.map((s, i) => (s.rtt === null ? <rect key={`x${i}`} x={x(i) - 1.5} y={H - 14} width="3" height="14" style={{ fill: "rgb(var(--accent))" }} /> : null))}
      {last && last.rtt !== null && <circle cx={x(lastIdx)} cy={y(last.rtt)} r="3.5" fill="#fff" style={{ stroke: "rgb(var(--accent))" }} strokeWidth="2" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}
