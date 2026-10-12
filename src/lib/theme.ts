// Theme engine: presets, wallpapers, and the user's appearance + app settings.
// Everything visual is driven by CSS variables on <html>, so a theme switch is
// one style write: no re-render of the whole tree, no rebuild.
import { useCallback, useEffect, useState } from "react";
import { api, isTauri } from "./api";

export type RGB = [number, number, number];

export type HSL = [number, number, number];
export type MaterialId = "frosted" | "liquid";

/** Liquid glass controls (0..100 except frost, which is blur px 0..20). */
export interface LiquidParams {
  refraction: number;
  dispersion: number;
  frost: number;
  glare: number;
}

export type MotionId = "off" | "drift" | "breathe" | "orbit" | "flow" | "stars" | "scan";

export const MOTIONS: { id: MotionId; name: string; blurb: string }[] = [
  { id: "off", name: "Still", blurb: "No movement" },
  { id: "drift", name: "Drift", blurb: "The whole background slowly glides" },
  { id: "breathe", name: "Breathe", blurb: "A soft glow gently swells and fades" },
  { id: "orbit", name: "Orbit", blurb: "Two glows circle each other" },
  { id: "flow", name: "Aurora", blurb: "Bands of colour flow across" },
  { id: "stars", name: "Stars", blurb: "Twinkling particles drift by" },
  { id: "scan", name: "Scan", blurb: "A faint light sweeps down, radar-style" },
];

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
  /** Exact hue / intensity / lightness behind customAccent, so sliders never drift. */
  customHsl: HSL | null;
  /** Two-colour accent: buttons, switches and rings blend accent -> accent2. */
  gradient: boolean;
  customAccent2: RGB | null;
  customHsl2: HSL | null;
  /** Card material. */
  material: MaterialId;
  /** Make glass solid when Windows' "Transparency effects" is off. */
  followTransparency: boolean;
  liquid: LiquidParams;
  wallpaper: WallpaperId;
  /** 0..40 px blur applied to the wallpaper. */
  blur: number;
  /** 0..90 % darkening over the wallpaper. */
  dim: number;
  /** 40..100 % card opacity. Lower shows more wallpaper through the glass. */
  glass: number;
  /** Animated background style. */
  motion: MotionId;
  // App behaviour
  autoBoost: boolean;
  checkUpdates: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  themeId: "crimson",
  customAccent: null,
  customHsl: null,
  gradient: false,
  customAccent2: null,
  customHsl2: null,
  material: "frosted",
  followTransparency: true,
  liquid: { refraction: 40, dispersion: 30, frost: 4, glare: 60 },
  wallpaper: "glow",
  blur: 12,
  dim: 45,
  glass: 80,
  motion: "off",
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
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> & { animate?: boolean };
      // 0.3.0 had a single on/off "animate" switch: keep its choice.
      if (!saved.motion) saved.motion = saved.animate ? "drift" : "off";
      delete saved.animate;
      // 0.4.0 stored only RGB: recover the exact HSL once so sliders start right.
      if (saved.customAccent && !saved.customHsl) saved.customHsl = rgbToHsl(saved.customAccent);
      return { ...DEFAULT_SETTINGS, ...saved, liquid: { ...DEFAULT_SETTINGS.liquid, ...(saved.liquid ?? {}) } };
    }
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

/** Second gradient colour: the user's pick, else the theme's companion colour. */
export function accent2Of(s: Settings): RGB {
  return s.customAccent2 ?? presetOf(s).alt;
}

/** Parses #RGB / #RRGGBB (with or without '#'). */
export function parseHex(input: string): RGB | null {
  const m = input.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(m)) return [0, 1, 2].map((i) => parseInt(m[i] + m[i], 16)) as RGB;
  if (/^[0-9a-f]{6}$/i.test(m)) return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16)) as RGB;
  return null;
}

/** Writes the theme into CSS variables. Cheap enough to call on every slider tick. */
export function applyTheme(s: Settings) {
  const p = presetOf(s);
  const a = accentOf(s);
  const a2 = accent2Of(s);
  const alt = s.gradient ? a2 : s.customAccent ? hslToRgb((rgbToHsl(a)[0] + 35) % 360, 85, 55) : p.alt;
  document.documentElement.classList.toggle("fo-follow-transparency", s.followTransparency);
  const root = document.documentElement.style;
  root.setProperty("--accent-2", css(s.gradient ? a2 : a));
  root.setProperty(
    "--accent-fill",
    s.gradient ? `linear-gradient(135deg, rgb(${css(a)}), rgb(${css(a2)}))` : `linear-gradient(180deg, rgb(${css(mix(a, [255, 255, 255], 0.12))}), rgb(${css(mix(a, [0, 0, 0], 0.15))}))`,
  );
  root.setProperty("--accent", css(a));
  root.setProperty("--accent-hi", css(mix(a, [255, 255, 255], 0.12)));
  root.setProperty("--accent-lo", css(mix(a, [0, 0, 0], 0.15)));
  root.setProperty("--accent-alt", css(alt));
  root.setProperty("--bg", css(p.bg));
  root.setProperty("--bg-2", css(mix(p.bg, [255, 255, 255], 0.03)));
  root.setProperty("--bg-3", css(mix(p.bg, [255, 255, 255], 0.055)));
  root.setProperty("--surface", css(mix(p.bg, [255, 255, 255], 0.045)));
  // Liquid glass is clear by nature: the same slider position shows more through.
  root.setProperty("--glass-alpha", String((s.glass / 100) * (s.material === "liquid" ? 0.45 : 1)));
  // Light accents (Mono) look washed out as a tint; tone the sheen down.
  root.setProperty("--sheen", String(rgbToHsl(a)[2] > 75 ? 0.4 : 1));
}

/* ------------------------------------------------------------ hook */

/** App-wide settings with persistence. Image is stored separately (it's large). */
export function useSettings() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [image, setImageState] = useState<string | null>(isTauri ? null : loadImage);

  // In the app the wallpaper file lives in the app data folder (GIFs and large
  // PNGs don't fit in browser storage). One-time move of an old stored image.
  useEffect(() => {
    if (!isTauri) return;
    (async () => {
      const legacy = loadImage();
      if (legacy) {
        try {
          await api.setWallpaper(legacy);
          localStorage.removeItem(IMAGE_KEY);
        } catch {
          /* keep it for next time */
        }
      }
      setImageState((await api.getWallpaper().catch(() => null)) ?? legacy);
    })();
  }, []);

  useEffect(() => {
    applyTheme(settings);
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  const update = useCallback((patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch })), []);

  const pickTheme = useCallback(
    (p: ThemePreset) =>
      setSettings((s) => ({ ...s, themeId: p.id, customAccent: null, customHsl: null, customAccent2: null, customHsl2: null, wallpaper: s.wallpaper === "image" ? "image" : p.wallpaper })),
    [],
  );

  /** Saves (or clears) the wallpaper. Throws with a readable message on failure. */
  const setImage = useCallback(async (dataUrl: string | null) => {
    if (isTauri) {
      if (dataUrl) await api.setWallpaper(dataUrl);
      else await api.clearWallpaper();
    } else {
      try {
        if (dataUrl) localStorage.setItem(IMAGE_KEY, dataUrl);
        else localStorage.removeItem(IMAGE_KEY);
      } catch {
        /* demo mode: keep for this session only */
      }
    }
    setImageState(dataUrl);
  }, []);

  const reset = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    setImage(null).catch(() => {});
  }, [setImage]);

  return { settings, update, pickTheme, image, setImage, reset };
}

export type SettingsApi = ReturnType<typeof useSettings>;

export const WALLPAPER_TYPES = "image/png,image/jpeg,image/gif";
const MAX_BYTES = 25 * 1024 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("That file couldn't be read"));
    r.readAsDataURL(file);
  });
}

/**
 * Prepares a picked PNG, JPG or GIF for use as a wallpaper.
 * GIFs are kept byte-for-byte so they stay animated; PNG and JPG are only
 * downscaled when larger than 2560 px, and PNG stays PNG (keeps transparency).
 */
export async function fileToWallpaper(file: File): Promise<string> {
  const type = file.type.toLowerCase();
  if (!["image/png", "image/jpeg", "image/gif"].includes(type)) throw new Error("Use a PNG, JPG or GIF image.");
  if (file.size > MAX_BYTES) throw new Error("That image is over 25 MB. Try a smaller one.");
  if (type === "image/gif") return readAsDataUrl(file);

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("That file isn't an image we can read"));
      i.src = url;
    });
    const scale = Math.min(1, 2560 / Math.max(img.width, img.height));
    if (scale === 1) return readAsDataUrl(file);
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
