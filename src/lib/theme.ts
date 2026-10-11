// Theme engine: presets, wallpapers, and the user's appearance + app settings.
// Everything visual is driven by CSS variables on <html>, so a theme switch is
// one style write: no re-render of the whole tree, no rebuild.
import { useCallback, useEffect, useState } from "react";

export type RGB = [number, number, number];

export type WallpaperId = "glow" | "aurora" | "grid" | "nebula" | "waves" | "plain" | "image";

export interface ThemePreset {
  id: string;
  name: string;
  accent: RGB;
  /** Second wallpaper colour (aurora/nebula blobs). */
  alt: RGB;
  bg: RGB;
  wallpaper: WallpaperId;
}

export const PRESETS: ThemePreset[] = [
  { id: "crimson", name: "Crimson", accent: [255, 30, 39], alt: [255, 110, 40], bg: [11, 11, 14], wallpaper: "glow" },
  { id: "abyss", name: "Abyss", accent: [56, 189, 248], alt: [20, 90, 160], bg: [6, 11, 18], wallpaper: "waves" },
  { id: "synthwave", name: "Synthwave", accent: [236, 72, 153], alt: [124, 58, 237], bg: [12, 8, 20], wallpaper: "nebula" },
  { id: "toxic", name: "Toxic", accent: [132, 225, 40], alt: [16, 185, 129], bg: [7, 12, 9], wallpaper: "aurora" },
  { id: "amethyst", name: "Amethyst", accent: [168, 85, 247], alt: [236, 72, 153], bg: [11, 8, 18], wallpaper: "aurora" },
  { id: "tactical", name: "Tactical", accent: [255, 140, 0], alt: [255, 60, 0], bg: [10, 10, 9], wallpaper: "grid" },
  { id: "sakura", name: "Sakura", accent: [251, 113, 133], alt: [253, 186, 116], bg: [16, 10, 13], wallpaper: "nebula" },
  { id: "mono", name: "Mono", accent: [226, 232, 240], alt: [100, 116, 139], bg: [9, 9, 11], wallpaper: "plain" },
];

export const WALLPAPERS: { id: WallpaperId; name: string }[] = [
  { id: "glow", name: "Glow" },
  { id: "aurora", name: "Aurora" },
  { id: "nebula", name: "Nebula" },
  { id: "waves", name: "Waves" },
  { id: "grid", name: "Grid" },
  { id: "plain", name: "Plain" },
];

export interface Settings {
  themeId: string;
  /** Overrides the preset accent when set (custom colour picker). */
  customAccent: RGB | null;
  wallpaper: WallpaperId;
  /** 0..40 px blur applied to the wallpaper. */
  blur: number;
  /** 0..90 % darkening over the wallpaper. */
  dim: number;
  /** 40..100 % card opacity. Lower shows more wallpaper through the glass. */
  glass: number;
  animate: boolean;
  // App behaviour
  autoBoost: boolean;
  checkUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  themeId: "crimson",
  customAccent: null,
  wallpaper: "glow",
  blur: 12,
  dim: 45,
  glass: 80,
  animate: false,
  autoBoost: false,
  checkUpdates: true,
};

const SETTINGS_KEY = "fo.settings";
const IMAGE_KEY = "fo.wallpaperImage";

export function loadSettings(): Settings {
  // Demo-only: ?theme=<preset> for README screenshots (never set inside the app).
  const demoTheme = "__TAURI_INTERNALS__" in window ? null : new URLSearchParams(location.search).get("theme");
  const preset = PRESETS.find((p) => p.id === demoTheme);
  if (preset) return { ...DEFAULT_SETTINGS, themeId: preset.id, wallpaper: preset.wallpaper };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_SETTINGS };
}

export function loadImage(): string | null {
  try {
    return localStorage.getItem(IMAGE_KEY);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ colour math */

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const mix = (a: RGB, b: RGB, t: number): RGB => [clamp(a[0] + (b[0] - a[0]) * t), clamp(a[1] + (b[1] - a[1]) * t), clamp(a[2] + (b[2] - a[2]) * t)];
const css = (c: RGB) => c.join(" ");

export function hslToRgb(h: number, s: number, l: number): RGB {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [clamp(f(0) * 255), clamp(f(8) * 255), clamp(f(4) * 255)];
}

export function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)];
}

export const toHex = (c: RGB) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("");

/* ------------------------------------------------------------ apply */

export function presetOf(s: Settings) {
  return PRESETS.find((p) => p.id === s.themeId) ?? PRESETS[0];
}

export function accentOf(s: Settings): RGB {
  return s.customAccent ?? presetOf(s).accent;
}

/** Writes the theme into CSS variables. Cheap enough to call on every slider tick. */
export function applyTheme(s: Settings) {
  const p = presetOf(s);
  const a = accentOf(s);
  const alt = s.customAccent ? hslToRgb((rgbToHsl(a)[0] + 35) % 360, 85, 55) : p.alt;
  const root = document.documentElement.style;
  root.setProperty("--accent", css(a));
  root.setProperty("--accent-hi", css(mix(a, [255, 255, 255], 0.12)));
  root.setProperty("--accent-lo", css(mix(a, [0, 0, 0], 0.15)));
  root.setProperty("--accent-alt", css(alt));
  root.setProperty("--bg", css(p.bg));
  root.setProperty("--bg-2", css(mix(p.bg, [255, 255, 255], 0.03)));
  root.setProperty("--bg-3", css(mix(p.bg, [255, 255, 255], 0.055)));
  root.setProperty("--surface", css(mix(p.bg, [255, 255, 255], 0.045)));
  root.setProperty("--glass-alpha", String(s.glass / 100));
  // Light accents (Mono) look washed out as a tint; tone the sheen down.
  root.setProperty("--sheen", String(rgbToHsl(a)[2] > 75 ? 0.4 : 1));
}

/* ------------------------------------------------------------ hook */

/** App-wide settings with persistence. Image is stored separately (it's large). */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [image, setImageState] = useState<string | null>(loadImage);

  useEffect(() => {
    applyTheme(settings);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  const pickTheme = useCallback((p: ThemePreset) => setSettings((s) => ({ ...s, themeId: p.id, customAccent: null, wallpaper: s.wallpaper === "image" ? "image" : p.wallpaper })), []);

  const setImage = useCallback((dataUrl: string | null) => {
    setImageState(dataUrl);
    try {
      if (dataUrl) localStorage.setItem(IMAGE_KEY, dataUrl);
      else localStorage.removeItem(IMAGE_KEY);
    } catch {
      /* quota: keep for this session only */
    }
  }, []);

  const reset = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    setImage(null);
  }, [setImage]);

  return { settings, update, pickTheme, image, setImage, reset };
}

export type SettingsApi = ReturnType<typeof useSettings>;

/** Downscales a picked image to <=1920px JPEG so it fits comfortably in storage. */
export async function fileToWallpaper(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("That file isn't an image we can read"));
      i.src = url;
    });
    const scale = Math.min(1, 1920 / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
