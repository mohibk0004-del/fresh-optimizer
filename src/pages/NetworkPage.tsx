import { Cable, Eraser, Radar, RotateCcw, Wifi } from "lucide-react";
import { useState } from "react";
import { GlassCard } from "../components/GlassCard";
import { Sparkline } from "../components/Sparkline";
import { Word } from "../components/ui";
import { api, errorText } from "../lib/api";
import { jitterWord, lossWord, pingWord } from "../lib/copy";
import type { NetStats, ToastKind } from "../lib/hooks";
import type { AppData } from "../lib/useAppData";

/** keywords -> friendly label, value that counts as tuned */
const NIC_CHECKS: [string[], string, string][] = [
  [["*EEE", "AdvancedEEE", "EEELinkAdvertisement"], "Power saving off", "0"],
  [["EnableGreenEthernet", "GreenEthernet"], "Green Ethernet off", "0"],
  [["*InterruptModeration"], "Instant delivery", "0"],
  [["*RSS"], "Multi-core receive", "1"],
  [["*LsoV2IPv4"], "No burst sending", "0"],
];

export function NetworkPage({ data, net, notify }: { data: AppData; net: NetStats; notify: (k: ToastKind, t: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const nic = data.system?.profile.nic;
  const ping = pingWord(net.samples.length ? net.avg : null);
  const jitter = jitterWord(net.jitter);
  const loss = lossWord(net.lossPct);

  const tool = (id: string, fn: () => Promise<string>, ok: string) => async () => {
    setBusy(id);
    try {
      await fn();
      notify("success", ok);
    } catch (e) {
      notify("error", errorText(e));
    }
    setBusy(null);
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] grid-rows-[minmax(0,1.2fr)_minmax(0,1fr)] gap-3.5">
      <GlassCard title="Live connection" subtitle="Pinging Cloudflare every 1.5 seconds" icon={Wifi}>
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Ping" big={net.samples.length ? `${net.avg.toFixed(0)} ms` : "—"} word={ping.word} tone={ping.tone} />
          <Metric label="Stability" big={net.samples.length > 1 ? `±${net.jitter.toFixed(1)} ms` : "—"} word={net.samples.length > 1 ? jitter.word : "Checking…"} tone={net.samples.length > 1 ? jitter.tone : "off"} />
          <Metric label="Packet loss" big={net.samples.length ? `${net.lossPct.toFixed(1)}%` : "—"} word={net.samples.length ? loss.word : "Checking…"} tone={net.samples.length ? loss.tone : "off"} />
        </div>
        <div className="relative -mx-1 mt-3 min-h-0 flex-1">
          <Sparkline samples={net.samples} />
        </div>
      </GlassCard>

      <GlassCard
        title="Check game servers"
        subtitle="Tests the route to 4 game networks"
        icon={Radar}
        className="row-span-2"
        action={
          <button type="button" className="btn-ghost" onClick={data.runProbe} disabled={data.probing}>
            <Radar size={13} className={data.probing ? "animate-spin" : ""} /> {data.probing ? "Testing…" : data.probe ? "Test again" : "Run test"}
          </button>
        }
      >
        {data.probe ? (
          <ul className="space-y-2">
            {data.probe.map((p) => {
              const w = p.received ? pingWord(p.avgMs) : null;
              return (
                <li key={p.host} className="glass-inset px-3.5 py-3" title={p.error ?? p.resolved ?? ""}>
                  <div className="flex items-center justify-between">
                    <span className="text-[13px] font-semibold">{p.label}</span>
                    {w ? <Word tone={p.lossPct > 0 ? "warn" : w.tone}>{p.lossPct > 0 ? "Drops packets" : w.word}</Word> : <span className="text-[12px] text-slate-muted">Doesn't answer pings</span>}
                  </div>
                  {p.received > 0 && (
                    <div className="mt-1 text-[12px] tabular-nums text-slate-muted">
                      {p.avgMs.toFixed(0)} ms · ±{p.jitterMs.toFixed(1)} ms · {p.lossPct.toFixed(0)}% lost
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="grid flex-1 place-items-center text-center">
            <div className="max-w-[260px]">
              <Radar size={28} className="mx-auto text-slate-muted" />
              <p className="mt-3 text-[13px] leading-relaxed text-slate-muted">
                Sends 20 pings to Cloudflare, Google, Riot and Valve at the same time and tells you which routes are steady.
              </p>
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard title="Your network card" subtitle={nic ? nic.description : "No connected adapter found"} icon={Cable}>
        <div className="flex flex-wrap gap-1.5">
          {NIC_CHECKS.map(([keys, label, good]) => {
            const p = data.nicProps?.find((x) => keys.includes(x.keyword));
            const state = !p ? "na" : p.value === good ? "on" : "off";
            return (
              <span
                key={label}
                title={p ? `${p.displayName}: ${p.value}` : "Your network card doesn't have this setting"}
                className={`chip ${state === "on" ? "border-success/25 text-success" : state === "off" ? "border-warn/30 text-warn" : "border-obsidian-line text-slate-muted/60"}`}
              >
                {label}
                {state === "na" && " · n/a"}
              </span>
            );
          })}
        </div>
        <div className="mt-2 text-[12px] text-slate-muted">{nic ? `${nic.linkSpeed} · driver ${nic.driverVersion}` : ""}</div>
        <div className="mt-auto flex gap-2 pt-3">
          <button type="button" className="btn-ghost" disabled={!!busy} onClick={tool("dns", api.flushDns, "DNS cache cleared.")}>
            <Eraser size={13} /> Clear DNS cache
          </button>
          <button type="button" className="btn-ghost" disabled={!!busy} onClick={tool("ws", api.resetWinsock, "Network stack reset. Restart your PC to finish.")} title="Fixes broken connections. Needs a restart.">
            <RotateCcw size={13} /> Repair network stack
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

function Metric({ label, big, word, tone }: { label: string; big: string; word: string; tone: "good" | "warn" | "bad" | "off" }) {
  return (
    <div className="glass-inset px-3.5 py-3">
      <div className="label">{label}</div>
      <div className="mt-1 text-[20px] font-bold tabular-nums tracking-tight">{big}</div>
      <Word tone={tone}>
        <span className="text-[12px]">{word}</span>
      </Word>
    </div>
  );
}
