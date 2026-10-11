import { Cable, Check, Eraser, Globe, Radar, RefreshCw, RotateCcw, Wifi } from "lucide-react";
import { useEffect, useState } from "react";
import { GlassCard } from "../components/GlassCard";
import { Sparkline } from "../components/Sparkline";
import { Switch, Word } from "../components/ui";
import { api, errorText } from "../lib/api";
import { jitterWord, lossWord, pingWord } from "../lib/copy";
import type { NetStats, ToastKind } from "../lib/hooks";
import type { DnsStatus } from "../lib/types";
import type { AppData } from "../lib/useAppData";

const TARGETS: [string, string][] = [
  ["1.1.1.1", "Cloudflare"],
  ["8.8.8.8", "Google"],
  ["9.9.9.9", "Quad9"],
];

/** Driver keyword(s), friendly copy, and the value that counts as "optimized". */
const NIC_SETTINGS: { keys: string[]; name: string; what: string; good: string; other: string }[] = [
  { keys: ["*EEE"], name: "Keep the card awake", what: "Turns off Energy-Efficient Ethernet naps", good: "0", other: "1" },
  { keys: ["EnableGreenEthernet", "GreenEthernet"], name: "Turn off Green Ethernet", what: "No power-saving link slowdowns", good: "0", other: "1" },
  { keys: ["*InterruptModeration"], name: "Deliver packets right away", what: "No waiting to batch packets together", good: "0", other: "1" },
  { keys: ["*RSS"], name: "Share work across cores", what: "Spreads incoming traffic over your CPU", good: "1", other: "0" },
  { keys: ["*LsoV2IPv4"], name: "No burst sending", what: "Sends data steadily instead of in big chunks", good: "0", other: "1" },
];

interface Props {
  data: AppData;
  net: NetStats;
  pingHost: string;
  setPingHost: (h: string) => void;
  notify: (k: ToastKind, t: string) => void;
}

export function NetworkPage({ data, net, pingHost, setPingHost, notify }: Props) {
  const nic = data.system?.profile.nic;
  const ping = pingWord(net.samples.length ? net.avg : null);
  const jitter = jitterWord(net.jitter);
  const loss = lossWord(net.lossPct);
  const [busyNic, setBusyNic] = useState<string | null>(null);
  const [dns, setDns] = useState<DnsStatus | null>(null);
  const [dnsBusy, setDnsBusy] = useState<string | null>(null);

  const { probe, probing, runProbe } = data;
  useEffect(() => {
    if (!probe && !probing) runProbe();
    api.dnsStatus(true).then(setDns).catch(() => {});
    // First visit only: run the checks once so the page opens with real answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleNic = async (keyword: string, value: string, name: string) => {
    setBusyNic(keyword);
    notify("info", "Applying… your connection will drop for a few seconds.");
    try {
      data.setNicProps(await api.setNicSetting(keyword, value));
      notify("success", `${name}: done.`);
    } catch (e) {
      notify("error", errorText(e));
    }
    setBusyNic(null);
  };

  const chooseDns = async (id: string, name: string) => {
    if (dns?.current === id) return;
    setDnsBusy(id);
    try {
      const next = await api.setDns(id);
      setDns((d) => (d ? { ...next, options: d.options } : next));
      notify("success", id === "auto" ? "DNS set back to automatic." : `Now using ${name} DNS.`);
    } catch (e) {
      notify("error", `Couldn't change DNS: ${errorText(e)}`);
    }
    setDnsBusy(null);
  };

  const remeasureDns = async () => {
    setDnsBusy("measure");
    try {
      setDns(await api.dnsStatus(true));
    } catch (e) {
      notify("error", errorText(e));
    }
    setDnsBusy(null);
  };

  const fastest = dns?.options.filter((o) => o.pingMs !== null).sort((a, b) => a.pingMs! - b.pingMs!)[0]?.id;
  const tool = (fn: () => Promise<string>, ok: string) => async () => {
    try {
      await fn();
      notify("success", ok);
    } catch (e) {
      notify("error", errorText(e));
    }
  };

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(0,1fr)] gap-3.5">
      {/* Live connection */}
      <GlassCard
        title="Live connection"
        subtitle="Updates every 1.5 seconds"
        icon={Wifi}
        action={
          <div className="flex rounded-lg border border-obsidian-line bg-black/30 p-0.5">
            {TARGETS.map(([host, label]) => (
              <button
                key={host}
                type="button"
                onClick={() => setPingHost(host)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors active:scale-[0.97] ${pingHost === host ? "bg-crimson/90 text-white" : "text-slate-muted hover:text-white"}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Ping" big={net.samples.length ? `${net.avg.toFixed(0)} ms` : "—"} word={ping.word} tone={ping.tone} />
          <Metric label="Stability" big={net.samples.length > 1 ? `±${net.jitter.toFixed(1)} ms` : "—"} word={net.samples.length > 1 ? jitter.word : "Checking…"} tone={net.samples.length > 1 ? jitter.tone : "off"} />
          <Metric label="Packet loss" big={net.samples.length ? `${net.lossPct.toFixed(1)}%` : "—"} word={net.samples.length ? loss.word : "Checking…"} tone={net.samples.length ? loss.tone : "off"} />
        </div>
        <div className="relative -mx-1 mt-2 min-h-[60px] flex-1">
          <Sparkline samples={net.samples} />
        </div>
      </GlassCard>

      {/* DNS */}
      <GlassCard
        title="DNS server"
        subtitle="Turns website and game-server names into addresses"
        icon={Globe}
        action={
          <button type="button" className="btn-ghost" onClick={remeasureDns} disabled={!!dnsBusy}>
            <RefreshCw size={12} className={dnsBusy === "measure" ? "animate-spin" : ""} /> Test speed
          </button>
        }
      >
        <div className="flex flex-col gap-1.5 overflow-y-auto pr-0.5">
          {(dns?.options ?? []).map((o) => {
            const active = dns?.current === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => chooseDns(o.id, o.name)}
                disabled={!!dnsBusy || !dns?.adapter}
                className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-colors active:scale-[0.99] disabled:cursor-wait ${
                  active ? "border-crimson-line bg-crimson/[0.08]" : "border-obsidian-line bg-black/20 hover:border-white/15"
                }`}
              >
                <span className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border ${active ? "border-crimson bg-crimson text-white" : "border-white/20"}`}>
                  {active && <Check size={11} strokeWidth={3.5} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[13px] font-medium">
                    {o.name}
                    {fastest === o.id && <span className="rounded-full bg-success/10 px-1.5 py-px text-[10px] font-semibold text-success">Fastest</span>}
                  </div>
                  <div className="truncate text-[11px] text-slate-muted">{o.id === "auto" ? "Whatever your router or ISP provides" : o.servers.join(" · ")}</div>
                </div>
                <span className="shrink-0 text-[12px] tabular-nums text-slate-muted">
                  {dnsBusy === o.id ? "Applying…" : o.pingMs !== null ? `${o.pingMs.toFixed(0)} ms` : dnsBusy === "measure" ? "…" : ""}
                </span>
              </button>
            );
          })}
          {dns?.current === "custom" && <p className="px-1 pt-1 text-[11px] text-slate-muted">Currently using your own servers: {dns.servers.join(", ")}</p>}
          {!dns && <p className="text-[12px] text-slate-muted">Reading your DNS settings…</p>}
        </div>
      </GlassCard>

      {/* NIC */}
      <GlassCard
        title="Network card"
        subtitle={nic ? `${nic.description} · ${nic.linkSpeed}` : "No connected adapter found"}
        icon={Cable}
        action={
          <button type="button" className="btn-ghost" disabled={!nic || !!busyNic} onClick={tool(api.restartAdapter, "Network card restarted.")} title="Turns the adapter off and on. Fixes a stuck connection.">
            <RotateCcw size={12} /> Restart card
          </button>
        }
      >
        <ul className="-mt-1 flex-1 divide-y divide-white/[0.05] overflow-y-auto pr-0.5">
          {NIC_SETTINGS.map((s) => {
            const p = data.nicProps?.find((x) => s.keys.includes(x.keyword));
            const optimized = p?.value === s.good;
            return (
              <li key={s.name} className="flex items-center gap-3 py-2" title={p ? `${p.displayName} = ${p.value}` : undefined}>
                <div className="min-w-0 flex-1">
                  <div className={`text-[13px] font-medium ${p ? "" : "text-slate-muted"}`}>{s.name}</div>
                  <div className="truncate text-[11.5px] text-slate-muted">{p ? s.what : "Your network card doesn't have this setting"}</div>
                </div>
                {busyNic === p?.keyword ? (
                  <RefreshCw size={14} className="animate-spin text-crimson-400" />
                ) : (
                  <Switch on={!!optimized} disabled={!p || !!busyNic} onChange={() => p && toggleNic(p.keyword, optimized ? s.other : s.good, s.name)} label={s.name} />
                )}
              </li>
            );
          })}
        </ul>
      </GlassCard>

      {/* Servers + tools */}
      <GlassCard
        title="Route check"
        subtitle="20 pings to each network, all at once"
        icon={Radar}
        action={
          <button type="button" className="btn-ghost" onClick={runProbe} disabled={probing}>
            <Radar size={12} className={probing ? "animate-spin" : ""} /> {probing ? "Testing…" : "Test again"}
          </button>
        }
      >
        <ul className="space-y-1">
          {(probe ?? []).map((p) => {
            const w = p.received ? pingWord(p.avgMs) : null;
            return (
              <li key={p.host} className="flex items-center justify-between gap-3 text-[12.5px]" title={p.error ?? p.resolved ?? ""}>
                <span className="font-medium">{p.label}</span>
                {w ? (
                  <span className="tabular-nums text-slate-muted">
                    {p.avgMs.toFixed(0)} ms · ±{p.jitterMs.toFixed(1)} · <Word tone={p.lossPct > 0 ? "warn" : w.tone}>{p.lossPct > 0 ? `${p.lossPct.toFixed(0)}% lost` : w.word}</Word>
                  </span>
                ) : (
                  <span className="text-slate-muted">Doesn't answer pings</span>
                )}
              </li>
            );
          })}
          {!probe && <li className="text-[12px] text-slate-muted">{probing ? "Testing your routes…" : "No results yet."}</li>}
        </ul>
        <div className="mt-auto flex gap-2 pt-3">
          <button type="button" className="btn-ghost" onClick={tool(api.flushDns, "DNS cache cleared.")}>
            <Eraser size={12} /> Clear DNS cache
          </button>
          <button type="button" className="btn-ghost" onClick={tool(api.resetWinsock, "Network stack reset. Restart your PC to finish.")} title="Fixes broken connections. Needs a restart.">
            <RotateCcw size={12} /> Repair network stack
          </button>
        </div>
      </GlassCard>
    </div>
  );
}

function Metric({ label, big, word, tone }: { label: string; big: string; word: string; tone: "good" | "warn" | "bad" | "off" }) {
  return (
    <div className="glass-inset px-3.5 py-2.5">
      <div className="label">{label}</div>
      <div className="mt-1 text-[19px] font-bold tabular-nums tracking-tight">{big}</div>
      <Word tone={tone}>
        <span className="text-[12px]">{word}</span>
      </Word>
    </div>
  );
}
