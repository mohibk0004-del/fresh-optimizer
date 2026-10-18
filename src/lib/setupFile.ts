// Export / import of the user's setup: appearance + app settings, which tweaks
// Boost uses, timer mode and per-game settings. Imports are validated field by
// field against what this version knows; anything else is ignored.
import { DEFAULT_SETTINGS, MOTIONS, PRESETS, WALLPAPERS, type Settings } from "./theme";
import type { GamePrefs, TimerMode, TweakInfo } from "./types";

export const SETUP_FORMAT = 1;

export interface SetupFile {
  app: "FreshOptimizer";
  format: number;
  exported: string;
  settings: Partial<Settings>;
  enabledTweaks: string[];
  timerMode: TimerMode;
  gamePrefs: Record<string, GamePrefs>;
}

export interface ParsedSetup {
  settings: Partial<Settings>;
  enabledTweaks: string[] | null;
  timerMode: TimerMode | null;
  gamePrefs: Record<string, GamePrefs>;
  /** Plain-language list of what importing would change. */
  changes: string[];
}

export function buildSetup(settings: Settings, enabled: Set<string>, timerMode: TimerMode, gamePrefs: Record<string, GamePrefs>): SetupFile {
  // The wallpaper image itself stays on this PC (it can be large and personal).
  return { app: "FreshOptimizer", format: SETUP_FORMAT, exported: new Date().toISOString(), settings, enabledTweaks: [...enabled].sort(), timerMode, gamePrefs };
}

const triple = (max: number) => (v: unknown) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && n >= 0 && n <= max);
const isRgb = triple(255);
const isHsl = triple(360);
const MATERIALS = ["frosted", "liquid"];

function validSetting(key: keyof Settings, v: unknown): boolean {
  const def = DEFAULT_SETTINGS[key];
  switch (key) {
    case "themeId":
      return PRESETS.some((p) => p.id === v);
    case "wallpaper":
      return v !== "image" && WALLPAPERS.some((w) => w.id === v);
    case "motion":
      return MOTIONS.some((m) => m.id === v);
    case "material":
      return MATERIALS.includes(v as string);
    case "customAccent":
    case "customAccent2":
      return v === null || isRgb(v);
    case "customHsl":
    case "customHsl2":
      return v === null || isHsl(v);
    case "liquid":
      return typeof v === "object" && v !== null;
    default:
      if (typeof def === "number") return typeof v === "number" && v >= 0 && v <= 100;
      return typeof v === typeof def;
  }
}

/** Reads a setup file. Throws a readable message if it isn't one. */
export function parseSetup(text: string, current: Settings, currentEnabled: Set<string>, tweaks: TweakInfo[], gameIds: string[]): ParsedSetup {
  let raw: Partial<SetupFile>;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file isn't a FreshOptimizer setup file.");
  }
  if (raw?.app !== "FreshOptimizer" || typeof raw.format !== "number") throw new Error("That file isn't a FreshOptimizer setup file.");
  if (raw.format > SETUP_FORMAT) throw new Error("That setup file is from a newer FreshOptimizer. Update first, then import it.");

  const changes: string[] = [];
  const settings: Partial<Settings> = {};
  const src = (raw.settings ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in src) || !validSetting(key, src[key])) continue;
    let value = src[key];
    if (key === "liquid") value = { ...DEFAULT_SETTINGS.liquid, ...(value as object) };
    (settings as Record<string, unknown>)[key] = value;
  }
  const appearanceKeys: (keyof Settings)[] = ["themeId", "customAccent", "gradient", "customAccent2", "material", "liquid", "wallpaper", "blur", "dim", "glass", "motion"];
  if (appearanceKeys.some((k) => k in settings && JSON.stringify(settings[k]) !== JSON.stringify(current[k]))) changes.push("Theme and appearance");
  const behaviour = Object.keys(settings).filter((k) => !appearanceKeys.includes(k as keyof Settings) && !["customHsl", "customHsl2", "followTransparency"].includes(k));
  const changedBehaviour = behaviour.filter((k) => JSON.stringify(settings[k as keyof Settings]) !== JSON.stringify(current[k as keyof Settings]));
  if (changedBehaviour.length) changes.push(`${changedBehaviour.length} app setting${changedBehaviour.length === 1 ? "" : "s"}`);

  const known = new Set(tweaks.map((t) => t.id));
  const enabledTweaks = Array.isArray(raw.enabledTweaks) ? raw.enabledTweaks.filter((id): id is string => typeof id === "string" && known.has(id)) : null;
  if (enabledTweaks) {
    const diff = enabledTweaks.filter((id) => !currentEnabled.has(id)).length + [...currentEnabled].filter((id) => !enabledTweaks.includes(id)).length;
    if (diff) changes.push(`${diff} Boost switch${diff === 1 ? "" : "es"}`);
  }

  const timerMode = raw.timerMode === "off" || raw.timerMode === "match" || raw.timerMode === "always" ? raw.timerMode : null;
  if (timerMode) changes.push(`Timer: ${timerMode === "match" ? "during games" : timerMode}`);

  const gamePrefs: Record<string, GamePrefs> = {};
  for (const [id, p] of Object.entries(raw.gamePrefs ?? {})) {
    if (!gameIds.includes(id) || typeof p !== "object" || p === null) continue;
    const g = p as Partial<GamePrefs>;
    if (typeof g.enabled === "boolean" && (g.priority === "high" || g.priority === "aboveNormal") && typeof g.fastCores === "boolean") {
      gamePrefs[id] = { enabled: g.enabled, priority: g.priority, fastCores: g.fastCores };
    }
  }
  const n = Object.keys(gamePrefs).length;
  if (n) changes.push(`Settings for ${n} game${n === 1 ? "" : "s"}`);

  return { settings, enabledTweaks, timerMode, gamePrefs, changes };
}
