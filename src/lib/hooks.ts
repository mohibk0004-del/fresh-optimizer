import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText, onEngineEvent } from "./api";
import type { EngineEvent, EngineStatus, RestoreSummary, TweakInfo, TweakStatus } from "./types";

/* ---------------- live ping monitor ---------------- */

export interface NetSample {
  t: number;
  rtt: number | null;
}

export interface NetStats {
  samples: NetSample[];
  last: number | null;
  avg: number;
  jitter: number;
  lossPct: number;
}

const WINDOW = 60;

/** Single-echo ping every `intervalMs` while the window is visible (zero cost when hidden). */
export function useNetMonitor(host = "1.1.1.1", intervalMs = 1500): NetStats {
  const [samples, setSamples] = useState<NetSample[]>([]);

  // New target, new graph: old samples would mix two different routes.
  useEffect(() => setSamples([]), [host]);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const tick = async () => {
      if (document.visibilityState === "visible") {
        let rtt: number | null = null;
        try {
          rtt = await api.pingOnce(host);
        } catch {
          rtt = null;
        }
        if (!alive) return;
        setSamples((s) => [...s.slice(-(WINDOW - 1)), { t: Date.now(), rtt }]);
      }
      if (alive) timer = window.setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [host, intervalMs]);

  const ok = samples.map((s) => s.rtt).filter((v): v is number => v !== null);
  const avg = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 0;
  let jitter = 0;
  if (ok.length > 1) {
    let d = 0;
    for (let i = 1; i < ok.length; i++) d += Math.abs(ok[i] - ok[i - 1]);
    jitter = d / (ok.length - 1);
  }
  const lossPct = samples.length ? ((samples.length - ok.length) / samples.length) * 100 : 0;
  return { samples, last: samples.at(-1)?.rtt ?? null, avg, jitter, lossPct };
}

/* ---------------- toasts ---------------- */

export type ToastKind = "info" | "success" | "error";
export interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
  title?: string;
}

/** Notification queue. The island shows one at a time and calls dismiss(). */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const push = useCallback((kind: ToastKind, text: string, title?: string) => {
    const id = ++seq.current;
    // Drop exact repeats still waiting in line.
    setToasts((t) => (t.some((x) => x.text === text) ? t : [...t.slice(-4), { id, kind, text, title }]));
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  return { toasts, push, dismiss };
}

/* ---------------- boost orchestration ---------------- */

export type TaskState = "idle" | "queued" | "running" | TweakStatus;
export interface TaskRow {
  state: TaskState;
  detail?: string;
}
export type Phase = "idle" | "boosting" | "active" | "stopping" | "reverting";

const ENABLED_KEY = "fo.enabledTweaks";

function loadEnabled(tweaks: TweakInfo[]): Set<string> {
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    /* storage unavailable: fall back to defaults */
  }
  return new Set(tweaks.filter((t) => t.defaultOn).map((t) => t.id));
}

export function useBoost(notify: (k: ToastKind, t: string) => void) {
  const [tweaks, setTweaks] = useState<TweakInfo[]>([]);
  const [enabled, setEnabled] = useState<Set<string>>(new Set());
  const [tasks, setTasks] = useState<Record<string, TaskRow>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [engine, setEngine] = useState<EngineStatus | null>(null);
  const [restore, setRestore] = useState<RestoreSummary | null>(null);
  const [events, setEvents] = useState<{ t: number; text: string; tone: "ok" | "warn" | "info" }[]>([]);
  const [nicRestart, setNicRestart] = useState<TaskState>("idle");

  const refreshRestore = useCallback(() => api.restoreSummary().then(setRestore).catch(() => {}), []);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.listTweaks();
        setTweaks(list);
        setEnabled(loadEnabled(list));
        const [eng, rs] = await Promise.all([api.engineStatus(), api.restoreSummary()]);
        setEngine(eng);
        setRestore(rs);
        if (eng.running) setPhase("active");
        const applied = new Set(rs.appliedTweaks);
        setTasks(Object.fromEntries(list.map((t) => [t.id, { state: applied.has(t.id) ? "applied" : "idle" } as TaskRow])));
      } catch (e) {
        notify("error", `Something went wrong starting up: ${errorText(e)}`);
      }
    })();
  }, [notify]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    onEngineEvent((e: EngineEvent) => {
      const now = Date.now();
      if (e.type === "gameStarted") {
        const g = e.game;
        const parts = [g.enforce.prioritySet ? "set to high priority" : null, g.enforce.affinitySet ? "using your fastest cores" : null].filter(Boolean);
        const text = parts.length ? `${g.game} started: ${parts.join(", ")}` : `${g.game} started. Its anti-cheat blocks live changes, so launch-time priority is used instead`;
        setEvents((x) => [{ t: now, text, tone: g.enforce.prioritySet ? ("ok" as const) : ("warn" as const) }, ...x].slice(0, 6));
      } else if (e.type === "gameExited") {
        setEvents((x) => [{ t: now, text: `${e.game} closed`, tone: "info" as const }, ...x].slice(0, 6));
      } else {
        setEvents((x) => [{ t: now, text: e.active ? "Full-power mode on" : "Back to normal power", tone: e.active ? ("ok" as const) : ("info" as const) }, ...x].slice(0, 6));
      }
      api.engineStatus().then(setEngine).catch(() => {});
    }).then((u) => (unlisten = u));
    return () => unlisten?.();
  }, []);

  const toggle = useCallback(
    (id: string) => {
      if (phase !== "idle") return;
      setEnabled((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        try {
          localStorage.setItem(ENABLED_KEY, JSON.stringify([...next]));
        } catch {
          /* ignore */
        }
        return next;
      });
    },
    [phase],
  );

  const resetRecommended = useCallback(() => {
    if (phase !== "idle") return;
    const next = new Set(tweaks.filter((t) => t.defaultOn).map((t) => t.id));
    setEnabled(next);
    try {
      localStorage.setItem(ENABLED_KEY, JSON.stringify([...next]));
    } catch {
      /* ignore */
    }
  }, [phase, tweaks]);

  const boost = useCallback(async () => {
    if (phase !== "idle") return;
    setPhase("boosting");
    setNicRestart("idle");
    const queue = tweaks.filter((t) => enabled.has(t.id));
    setTasks((prev) => {
      const next = { ...prev };
      for (const t of queue) next[t.id] = { state: "queued" };
      return next;
    });

    let failed = 0;
    let nicDirty = false;
    for (const t of queue) {
      setTasks((p) => ({ ...p, [t.id]: { state: "running" } }));
      try {
        const r = await api.applyTweak(t.id);
        if (r.status === "failed") failed++;
        if (r.needsNicRestart) nicDirty = true;
        setTasks((p) => ({ ...p, [t.id]: { state: r.status, detail: r.detail } }));
      } catch (e) {
        failed++;
        setTasks((p) => ({ ...p, [t.id]: { state: "failed", detail: errorText(e) } }));
      }
    }

    if (nicDirty) {
      setNicRestart("running");
      try {
        await api.finalizeBoost();
        setNicRestart("applied");
      } catch (e) {
        setNicRestart("failed");
        notify("error", `Couldn't restart your network card: ${errorText(e)}`);
      }
    }

    try {
      setEngine(await api.engineStart());
      setPhase("active");
      notify(failed ? "error" : "success", failed ? `Boosted, but ${failed} change${failed === 1 ? "" : "s"} didn't work. See the Tweaks page.` : "You're boosted. We'll go full power when a game starts.");
    } catch (e) {
      setPhase("idle");
      notify("error", `Couldn't start the game watcher: ${errorText(e)}`);
    }
    refreshRestore();
  }, [phase, tweaks, enabled, notify, refreshRestore]);

  const stop = useCallback(async () => {
    if (phase !== "active") return;
    setPhase("stopping");
    try {
      setEngine(await api.engineStop());
      notify("info", "Boost paused. Your tweaks stay on until you undo them.");
    } catch (e) {
      notify("error", errorText(e));
    }
    setPhase("idle");
  }, [phase, notify]);

  const revert = useCallback(async () => {
    if (phase === "boosting" || phase === "reverting") return;
    setPhase("reverting");
    try {
      const r = await api.rollback();
      setEngine(await api.engineStatus());
      setTasks((p) => Object.fromEntries(Object.keys(p).map((k) => [k, { state: "idle" } as TaskRow])));
      setNicRestart("idle");
      if (r.failed.length) notify("error", `Undid ${r.restored} changes, but ${r.failed.length} couldn't be reverted: ${r.failed[0]}`);
      else notify("success", `All done. Your PC is back to how it was (${r.restored} settings).`);
    } catch (e) {
      notify("error", `Undo failed: ${errorText(e)}`);
    }
    setPhase("idle");
    refreshRestore();
  }, [phase, notify, refreshRestore]);

  return { tweaks, enabled, toggle, resetRecommended, tasks, phase, engine, restore, events, nicRestart, boost, stop, revert };
}
export type Boost = ReturnType<typeof useBoost>;
