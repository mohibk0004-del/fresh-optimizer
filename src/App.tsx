import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { EngineCard } from "./components/EngineCard";
import { GamesCard } from "./components/GamesCard";
import { NetworkCard } from "./components/NetworkCard";
import { BoostButton, ConfirmRevert, Toasts } from "./components/Overlays";
import { Sidebar, type NavId } from "./components/Sidebar";
import { SystemCard } from "./components/SystemCard";
import { api, errorText, isTauri } from "./lib/api";
import { useBoost, useNetMonitor, useToasts } from "./lib/hooks";
import type { GameInfo, LatencyReport, NicProperty, PingStats, SystemSnapshot } from "./lib/types";

export default function App() {
  const { toasts, push } = useToasts();
  const boost = useBoost(push);
  const net = useNetMonitor();

  const [nav, setNav] = useState<NavId>("dashboard");
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [latency, setLatency] = useState<LatencyReport | null>(null);
  const [latencyBusy, setLatencyBusy] = useState(false);
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [nicProps, setNicProps] = useState<NicProperty[] | null>(null);
  const [probe, setProbe] = useState<PingStats[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const measure = useCallback(async () => {
    setLatencyBusy(true);
    try {
      setLatency(await api.measureLatency());
    } catch (e) {
      push("error", `Latency probe failed: ${errorText(e)}`);
    }
    setLatencyBusy(false);
  }, [push]);

  const refreshLive = useCallback(async (refreshProfile = false) => {
    try {
      setSystem(await api.systemInfo(refreshProfile));
    } catch (e) {
      push("error", `Hardware profile failed: ${errorText(e)}`);
    }
    api.games().then(setGames).catch(() => setGames([]));
    api.nicProperties().then(setNicProps).catch(() => setNicProps([]));
  }, [push]);

  // Initial load.
  useEffect(() => {
    refreshLive().then(measure);
  }, [refreshLive, measure]);

  // Re-read live state whenever the engine or boost state changes.
  useEffect(() => {
    if (boost.phase === "active" || boost.phase === "idle") refreshLive();
  }, [boost.phase, boost.engine?.activeGames.length, boost.engine?.timerHeld, refreshLive]);

  // Light periodic refresh of game/process state (8 s; paused when hidden).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") api.games().then(setGames).catch(() => {});
    }, 8000);
    return () => window.clearInterval(id);
  }, []);

  const runProbe = async () => {
    setProbing(true);
    try {
      setProbe(await api.pingProbe());
    } catch (e) {
      push("error", `Probe failed: ${errorText(e)}`);
    }
    setProbing(false);
  };

  const simple = (fn: () => Promise<string>) => async () => {
    try {
      push("success", await fn());
    } catch (e) {
      push("error", errorText(e));
    }
  };

  const selectNav = (id: NavId) => {
    setNav(id);
    if (id !== "dashboard") document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  };

  const queue = boost.tweaks.filter((t) => boost.enabled.has(t.id));
  const doneCount = queue.filter((t) => ["applied", "skipped", "failed"].includes(boost.tasks[t.id]?.state ?? "")).length;
  const restoreOk = !!boost.restore?.exists;

  return (
    <div className="flex h-full gap-4 p-4">
      <Sidebar active={nav} onSelect={selectNav} onRestore={() => setConfirmOpen(true)} restoreAvailable={restoreOk} />

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="mb-3 flex items-center justify-between gap-4 px-1">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight">
              Fresh<span className="text-crimson text-glow">Optimizer</span>
            </h1>
            <p className="text-xs text-slate-muted">Frametime stability · input latency · packet integrity — no injection, no memory hooks.</p>
          </div>
          <div className="flex items-center gap-2">
            {!isTauri && <span className="chip border-warn/30 bg-warn/10 text-warn">Preview data</span>}
            {system && (
              <span className={`chip ${system.isAdmin ? "border-success/25 bg-success/10 text-success" : "border-crimson-line bg-crimson/10 text-crimson-400"}`}>
                {system.isAdmin ? <ShieldCheck size={12} /> : <ShieldAlert size={12} />}
                {system.isAdmin ? "Administrator" : "Not elevated"}
              </span>
            )}
            <span className={`chip ${restoreOk ? "border-crimson-line bg-crimson/10 text-white" : "border-obsidian-line bg-white/[0.03] text-slate-muted"}`}>
              Restore point {restoreOk ? `· ${boost.restore!.entryCount} items` : "· baseline"}
            </span>
            <span className="chip border-obsidian-line bg-white/[0.03] text-slate-muted">VAC · Vanguard · EAC safe</span>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,7fr)] grid-rows-[minmax(0,1.14fr)_minmax(0,1fr)] gap-3.5 pb-[82px]">
          <SystemCard system={system} latency={latency} latencyBusy={latencyBusy} onMeasure={measure} highlight={nav === "system"} />
          <EngineCard
            tweaks={boost.tweaks}
            enabled={boost.enabled}
            tasks={boost.tasks}
            nicRestart={boost.nicRestart}
            phase={boost.phase}
            engine={boost.engine}
            events={boost.events}
            net={net}
            onToggle={boost.toggle}
            highlight={nav === "engine"}
          />
          <GamesCard
            games={games}
            active={boost.engine?.activeGames ?? []}
            topology={system?.profile.topology}
            launchPriority={boost.tasks["ifeo_priority"]?.state === "applied"}
            highlight={nav === "games"}
          />
          <NetworkCard
            net={net}
            nic={system?.profile.nic}
            nicProps={nicProps}
            probe={probe}
            probing={probing}
            onProbe={runProbe}
            onFlushDns={simple(api.flushDns)}
            onResetWinsock={simple(api.resetWinsock)}
            highlight={nav === "network"}
          />
        </div>
      </main>

      <BoostButton phase={boost.phase} progress={`${doneCount}/${queue.length}`} onBoost={boost.boost} onStop={boost.stop} />
      <ConfirmRevert
        open={confirmOpen}
        entries={boost.restore?.entryCount ?? 0}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          boost.revert();
        }}
      />
      <Toasts toasts={toasts} />
    </div>
  );
}
