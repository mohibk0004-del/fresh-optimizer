import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "./api";
import type { ToastKind } from "./hooks";
import type { GameInfo, LatencyReport, NicProperty, PingStats, SystemSnapshot } from "./types";

/** Machine-level data shared by every page (hardware, games, NIC, probes). */
export function useAppData(notify: (k: ToastKind, t: string) => void) {
  const [system, setSystem] = useState<SystemSnapshot | null>(null);
  const [latency, setLatency] = useState<LatencyReport | null>(null);
  const [latencyBusy, setLatencyBusy] = useState(false);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [games, setGames] = useState<GameInfo[] | null>(null);
  const [icons, setIcons] = useState<Record<string, string>>({});
  const [nicProps, setNicProps] = useState<NicProperty[] | null>(null);
  const [probe, setProbe] = useState<PingStats[] | null>(null);
  const [probing, setProbing] = useState(false);
  const [loadStep, setLoadStep] = useState<"hardware" | "games" | "ready">("hardware");

  const measure = useCallback(async () => {
    setLatencyBusy(true);
    try {
      const r = await api.measureLatency();
      setLatency(r);
      setLatencyHistory((h) => [...h.slice(-4), r.score]);
    } catch (e) {
      notify("error", `Couldn't run the smoothness test: ${errorText(e)}`);
    }
    setLatencyBusy(false);
  }, [notify]);

  const refreshGames = useCallback(() => api.games().then(setGames).catch(() => setGames([])), []);

  const refresh = useCallback(async () => {
    try {
      setSystem(await api.systemInfo(false));
    } catch (e) {
      notify("error", `Couldn't read your hardware: ${errorText(e)}`);
    }
    refreshGames();
    api.nicProperties().then(setNicProps).catch(() => setNicProps([]));
  }, [notify, refreshGames]);

  // First load drives the splash screen steps.
  useEffect(() => {
    (async () => {
      try {
        setSystem(await api.systemInfo(false));
      } catch (e) {
        notify("error", `Couldn't read your hardware: ${errorText(e)}`);
      }
      setLoadStep("games");
      await refreshGames();
      api.gameIcons().then(setIcons).catch(() => {});
      api.nicProperties().then(setNicProps).catch(() => setNicProps([]));
      setLoadStep("ready");
      measure();
    })();
  }, [notify, refreshGames, measure]);

  // Keep "playing now" fresh (8 s, paused while the window is hidden).
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshGames();
    }, 8000);
    return () => window.clearInterval(id);
  }, [refreshGames]);

  const runProbe = useCallback(async () => {
    setProbing(true);
    try {
      setProbe(await api.pingProbe());
    } catch (e) {
      notify("error", `Connection check failed: ${errorText(e)}`);
    }
    setProbing(false);
  }, [notify]);

  return { icons, system, latency, latencyBusy, latencyHistory, measure, games, refreshGames, nicProps, setNicProps, probe, probing, runProbe, refresh, loadStep };
}

export type AppData = ReturnType<typeof useAppData>;
