import type {
  EngineEvent,
  EngineStatus,
  GameInfo,
  LatencyReport,
  NicProperty,
  PingStats,
  PingTarget,
  RestoreSummary,
  RollbackReport,
  SystemSnapshot,
  TweakInfo,
  TweakResult,
} from "./types";

/** True inside the Tauri webview; false in a plain browser (`npm run dev`). */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return (await import("./mock")).handle<T>(cmd, args);
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const api = {
  systemInfo: (refresh = false) => call<SystemSnapshot>("get_system_info", { refresh }),
  measureLatency: () => call<LatencyReport>("measure_latency"),
  games: () => call<GameInfo[]>("get_games"),
  listTweaks: () => call<TweakInfo[]>("list_tweaks"),
  applyTweak: (id: string) => call<TweakResult>("apply_tweak", { id }),
  finalizeBoost: () => call<string | null>("finalize_boost"),
  restoreSummary: () => call<RestoreSummary>("restore_summary"),
  rollback: () => call<RollbackReport>("rollback"),
  engineStart: () => call<EngineStatus>("engine_start"),
  engineStop: () => call<EngineStatus>("engine_stop"),
  engineStatus: () => call<EngineStatus>("engine_status"),
  pingProbe: (targets?: PingTarget[], samples = 20) => call<PingStats[]>("ping_probe", { targets, samples }),
  pingOnce: (host = "1.1.1.1") => call<number | null>("ping_once", { host }),
  nicProperties: () => call<NicProperty[]>("nic_properties"),
  flushDns: () => call<string>("flush_dns"),
  resetWinsock: () => call<string>("reset_winsock"),
};

export async function onEngineEvent(cb: (e: EngineEvent) => void): Promise<() => void> {
  if (!isTauri) return (await import("./mock")).onEngineEvent(cb);
  const { listen } = await import("@tauri-apps/api/event");
  return listen<EngineEvent>("engine-event", (e) => cb(e.payload));
}

export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return JSON.stringify(e);
}
