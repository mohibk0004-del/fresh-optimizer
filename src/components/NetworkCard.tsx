import { Eraser, Network, Radar, RotateCcw, ShieldCheck } from "lucide-react";
import type { NetStats } from "../lib/hooks";
import type { NicInfo, NicProperty, PingStats } from "../lib/types";
import { Dot, GlassCard, Stat } from "./GlassCard";

interface Props {
  net: NetStats;
  nic: NicInfo | null | undefined;
  nicProps: NicProperty[] | null;
  probe: PingStats[] | null;
  probing: boolean;
  onProbe: () => void;
  onFlushDns: () => void;
  onResetWinsock: () => void;
  highlight?: boolean;
}

/** keyword -> [label, value that counts as optimized] */
const NIC_CHECKS: [string[], string, string][] = [
  [["*EEE", "AdvancedEEE", "EEELinkAdvertisement"], "EEE", "0"],
  [["EnableGreenEthernet", "GreenEthernet"], "Green", "0"],
  [["*InterruptModeration"], "IntMod", "0"],
  [["*RSS"], "RSS", "1"],
  [["*LsoV2IPv4"], "LSO", "0"],
];

export function NetworkCard({ net, nic, nicProps, probe, probing, onProbe, onFlushDns, onResetWinsock, highlight }: Props) {
  const jitterTone = net.jitter < 2 ? "good" : net.jitter < 5 ? "warn" : "bad";
  const lossTone = net.lossPct === 0 ? "good" : net.lossPct < 2 ? "warn" : "bad";

  return (
    <GlassCard
      id="network"
      title="Network & Packet Guard"
      subtitle="Jitter · packet loss · NIC tuning"
      icon={Network}
      highlight={highlight}
      delay={0.2}
      action={
        <button type="button" className="btn-ghost" onClick={onProbe} disabled={probing}>
          <Radar size={13} className={probing ? "animate-spin" : ""} /> {probing ? "Probing…" : "Route probe"}
        </button>
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Ping" value={net.samples.length ? net.avg.toFixed(1) : "—"} unit="ms" sub="rolling 90 s avg" />
        <Stat label="Jitter" value={net.samples.length > 1 ? net.jitter.toFixed(2) : "—"} unit="ms" tone={net.samples.length > 1 ? jitterTone : "default"} sub="mean |Δ RTT|" />
        <Stat label="Packet loss" value={net.samples.length ? net.lossPct.toFixed(1) : "—"} unit="%" tone={net.samples.length ? lossTone : "default"} sub={`${net.samples.filter((s) => s.rtt === null).length} drops / ${net.samples.length}`} />
      </div>

      <div className="mt-2 grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] gap-2">
        <div className="glass-inset flex min-w-0 flex-col px-3 py-2.5">
          <div className="label flex items-center gap-1.5">
            <ShieldCheck size={12} /> Active NIC
          </div>
          <div className="mt-1 truncate text-[13px] font-medium" title={nic?.description}>
            {nic ? nic.description : "No routed adapter"}
          </div>
          <div className="truncate text-[11px] text-slate-muted">{nic ? `${nic.linkSpeed} · ${nic.media || "—"} · drv ${nic.driverVersion}` : "—"}</div>
          <div className="mt-auto flex gap-1 overflow-hidden pt-1.5">
            {NIC_CHECKS.map(([keys, label, good]) => {
              const p = nicProps?.find((x) => keys.includes(x.keyword));
              const tone = !p ? "off" : p.value === good ? "good" : "warn";
              return (
                <span key={label} title={p ? `${p.displayName}: ${p.value}` : "Not exposed by this driver"} className={`chip !gap-1 !px-1.5 !py-0 !text-[10px] ${tone === "good" ? "border-success/25 text-success" : tone === "warn" ? "border-warn/30 text-warn" : "border-obsidian-line text-slate-muted line-through decoration-white/20"}`}>
                  <Dot tone={tone} /> {label}
                </span>
              );
            })}
          </div>
        </div>

        <div className="glass-inset flex min-w-0 flex-col px-3 py-2.5">
          <div className="label mb-1">Edge nodes {probe ? "· 20 samples" : ""}</div>
          {probe ? (
            <table className="w-full text-[11px] tabular-nums">
              <thead className="text-slate-muted">
                <tr>
                  <th className="pb-1 text-left font-medium">Target</th>
                  <th className="pb-1 text-right font-medium">avg</th>
                  <th className="pb-1 text-right font-medium">jit</th>
                  <th className="pb-1 text-right font-medium">loss</th>
                </tr>
              </thead>
              <tbody>
                {probe.map((p) => (
                  <tr key={p.host} title={p.error ?? p.resolved ?? ""}>
                    <td className="max-w-[90px] truncate py-[2px] pr-2 text-white/90">{p.label}</td>
                    {p.received === 0 ? (
                      <td colSpan={3} className="py-[3px] text-right text-slate-muted">
                        no ICMP reply
                      </td>
                    ) : (
                      <>
                        <td className="py-[3px] text-right">{p.avgMs.toFixed(1)}</td>
                        <td className={`py-[3px] text-right ${p.jitterMs < 2 ? "text-success" : p.jitterMs < 5 ? "text-warn" : "text-crimson-400"}`}>{p.jitterMs.toFixed(1)}</td>
                        <td className={`py-[3px] text-right ${p.lossPct === 0 ? "text-success" : "text-crimson-400"}`}>{p.lossPct.toFixed(0)}%</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-[11px] leading-snug text-slate-muted">Parallel ICMP probe: Cloudflare, Google, Riot, Valve edges.</p>
          )}
          <div className="mt-auto flex gap-1.5 pt-1.5">
            <button type="button" className="btn-ghost flex-1 justify-center" onClick={onFlushDns}>
              <Eraser size={12} /> Flush DNS
            </button>
            <button type="button" className="btn-ghost flex-1 justify-center" onClick={onResetWinsock}>
              <RotateCcw size={12} /> Winsock reset
            </button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
