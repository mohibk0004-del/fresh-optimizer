import type {
  DnsStatus,
  EngineEvent,
  GamePrefs,
  StartupItem,
  UpdateInfo,
  TimerInfo,
  TimerMode,
  Trace,
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
  TweakResult, DisplayInfo, FpsSession, FpsStatus, AgentSettings, GameAdvice, MatchReport } from "./types";

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
  gamePrefs: () => call<Record<string, GamePrefs>>("get_game_prefs"),
  setGamePrefs: (id: string, prefs: GamePrefs) => call<void>("set_game_prefs", { id, prefs }),
  launchGame: (id: string) => call<string>("launch_game", { id }),
  openGameFolder: (id: string) => call<void>("open_game_folder", { id }),
  setNicSetting: (keyword: string, value: string) => call<NicProperty[]>("set_nic_setting", { keyword, value }),
  restartAdapter: () => call<string>("restart_adapter"),
  dnsStatus: (measure = false) => call<DnsStatus>("dns_status", { measure }),
  setDns: (preset: string) => call<DnsStatus>("set_dns", { preset }),
  startupApps: () => call<StartupItem[]>("list_startup"),
  setStartup: (source: string, name: string, enabled: boolean) => call<void>("set_startup", { source, name, enabled }),
  openSettings: (page: string) => call<void>("open_settings", { page }),
  checkUpdate: () => call<UpdateInfo>("check_update"),
  installUpdate: (url: string) => call<void>("install_update", { url }),
  openProjectUrl: (url: string) => call<void>("open_project_url", { url }),
  getLaunchAtStartup: () => call<boolean>("get_launch_at_startup"),
  setLaunchAtStartup: (enabled: boolean) => call<boolean>("set_launch_at_startup", { enabled }),
  openDataFolder: () => call<void>("open_data_folder"),
  appVersion: () => call<string>("app_version"),
  getTimer: () => call<TimerInfo>("get_timer"),
  fpsStatus: () => call<FpsStatus>("fps_status"),
  fpsInstall: () => call<FpsStatus>("fps_install"),
  fpsUninstall: () => call<FpsStatus>("fps_uninstall"),
  fpsClear: () => call<FpsStatus>("fps_clear"),
  hogLower: (pid: number) => call<void>("hog_lower", { pid }),
  hogClose: (pid: number) => call<void>("hog_close", { pid }),
  setAgentSettings: (settings: AgentSettings) => call<void>("set_agent_settings", { settings }),
  gameAdvice: () => call<Record<string, GameAdvice>>("game_advice"),
  matchReports: () => call<MatchReport[]>("match_reports"),
  clearMatchReports: () => call<void>("clear_match_reports"),
  listDisplays: () => call<DisplayInfo[]>("list_displays"),
  setRefreshRate: (device: string, hz: number) => call<DisplayInfo>("set_refresh_rate", { device, hz }),
  setTimerMode: (mode: TimerMode) => call<TimerInfo>("set_timer_mode", { mode }),
  traceRoute: (host: string) => call<Trace>("trace_route", { host }),
  gameIcons: () => call<Record<string, string>>("game_icons"),
  setWallpaper: (data: string) => call<void>("set_wallpaper", { data }),
  getWallpaper: () => call<string | null>("get_wallpaper"),
  clearWallpaper: () => call<void>("clear_wallpaper"),
};

/** Demo-only URL params (browser preview / README screenshots). Ignored in the app. */
export const demoParams = new URLSearchParams(isTauri ? "" : location.search);
export const SHOT_MODE = demoParams.has("shot");

export const REPO_URL = "https://github.com/mohibk0004-del/fresh-optimizer";

export async function onFpsSession(cb: (s: FpsSession) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<FpsSession>("fps-session", (e) => cb(e.payload));
}

export async function onMatchReport(cb: (r: MatchReport) => void): Promise<() => void> {
  if (!isTauri) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<MatchReport>("match-report", (e) => cb(e.payload));
}

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
