// Plain-language copy for everything a casual player sees. Technical names stay
// in the Rust catalog (and in tooltips) so power users can still find them.
import type { TweakCategory } from "./types";

export interface TweakCopy {
  name: string;
  what: string;
}

export const TWEAK_COPY: Record<string, TweakCopy> = {
  nagle: { name: "Send game packets instantly", what: "Stops Windows from bundling small packets together, so your shots reach the server sooner." },
  net_throttling: { name: "Remove the hidden network limit", what: "Windows quietly slows some traffic while media plays. This turns that off." },
  tcp_autotuning: { name: "Keep downloads healthy", what: "Puts Windows' connection tuning back on its recommended setting." },
  nic_eee: { name: "Keep your network card awake", what: "Stops your Ethernet card from napping between packets. It reconnects for a second." },
  nic_interrupt: { name: "Deliver packets right away", what: "Your network card stops waiting to batch packets together. Less delay, a tiny bit more CPU." },
  nic_rss_lso: { name: "Share network work across cores", what: "Spreads incoming traffic over your CPU cores and stops sending data in big bursts." },
  gamedvr: { name: "Turn off background recording", what: "Stops Xbox Game Bar from recording in the background while you play." },
  game_mode: { name: "Turn on Windows Game Mode", what: "Lets Windows put your game first and hold back updates while you play." },
  mmcss_games: { name: "Put games first in line", what: "Tells Windows' scheduler to give games more CPU and GPU priority." },
  global_timer: { name: "Sharpen the system clock", what: "Lets the faster in-match timer apply to the whole system. Needs a restart." },
  fso: { name: "Use true fullscreen", what: "Turns off fullscreen optimizations for your games, which can add input lag." },
  ifeo_priority: { name: "Start games at high priority", what: "Windows itself launches your games at high priority. Nothing touches the game process." },
  power_scheme: { name: "Full power while you play", what: "Creates a power plan that keeps every core awake. Only switched on during a match." },
  cstate_lock: { name: "Never let the CPU rest (advanced)", what: "Lowest possible delay, but your CPU runs hotter and uses more power. Off by default." },

  // From SG TCP Optimizer
  tcp_coalescing: { name: "Don't hold back incoming packets", what: "Windows normally waits a moment to merge incoming packets into bigger chunks. This hands each one over straight away. Your connection reconnects for a second." },
  tcp_heuristics: { name: "Stop Windows shrinking your connection", what: "Prevents Windows from deciding on its own to limit how much data your connection can receive at once." },
  tcp_cubic: { name: "Modern congestion control", what: "Uses CUBIC, the method Windows 11 uses by default, to recover quickly from busy networks. Older Windows 10 builds use an older method." },
  dns_priority: { name: "Faster name lookups", what: "Windows checks its own cache and hosts file before slower lookup methods. The gain is small. Needs a restart." },

  // From Optimizer
  sys_responsiveness: { name: "Less CPU held back for background tasks", what: "While a game runs, Windows keeps 20% of CPU time free for background tasks. This lowers it to 10%." },
  telemetry_services: { name: "Turn off background diagnostics", what: "Stops Windows' data-collection services, which use a little CPU, disk and network in the background." },
  menu_delay: { name: "Instant menus", what: "Removes the 0.4-second delay before menus open on the desktop." },
  widgets_off: { name: "Turn off Widgets and news", what: "Turns off the Widgets board and the background process that keeps it updated. Applies after you sign out." },
  background_apps: { name: "Stop Store apps running in the background", what: "Microsoft Store apps only run while they're open. Some, like Mail, will stop showing live notifications." },
  sysmain_off: { name: "Turn off SysMain (Superfetch)", what: "Stops Windows preloading apps into memory. Can reduce disk activity, but apps may open a little slower. Off by default." },

  // Input
  mouse_accel_off: { name: "Turn off mouse acceleration", what: "Turns off 'Enhance pointer precision', so your aim moves the same distance however fast you move the mouse. Your desktop mouse will feel different." },
  sticky_keys_off: { name: "No Sticky Keys pop-up", what: "Pressing Shift five times mid-game no longer opens the Sticky Keys prompt." },
};

export function tweakName(id: string, fallback: string) {
  return TWEAK_COPY[id]?.name ?? fallback;
}

export interface Group {
  id: string;
  title: string;
  blurb: string;
  cats: TweakCategory[];
}

export const GROUPS: Group[] = [
  { id: "network", title: "Network", blurb: "Lower lag and fewer ping spikes", cats: ["network", "nic"] },
  { id: "system", title: "Windows", blurb: "Less background noise while you play", cats: ["system"] },
  { id: "game", title: "Games & input", blurb: "Your games first, and cleaner aim", cats: ["game"] },
  { id: "power", title: "Power", blurb: "No slowdowns mid-match", cats: ["power"] },
];

export type Tone = "good" | "warn" | "bad" | "off";

export function pingWord(ms: number | null): { word: string; tone: Tone } {
  if (ms === null) return { word: "Checking…", tone: "off" };
  if (ms < 30) return { word: "Excellent", tone: "good" };
  if (ms < 60) return { word: "Good", tone: "good" };
  if (ms < 100) return { word: "Okay", tone: "warn" };
  return { word: "Laggy", tone: "bad" };
}

export function jitterWord(ms: number): { word: string; tone: Tone } {
  if (ms < 2) return { word: "Rock steady", tone: "good" };
  if (ms < 5) return { word: "A little bumpy", tone: "warn" };
  return { word: "Unstable", tone: "bad" };
}

export function lossWord(pct: number): { word: string; tone: Tone } {
  if (pct === 0) return { word: "No drops", tone: "good" };
  if (pct < 2) return { word: "A few drops", tone: "warn" };
  return { word: "Dropping packets", tone: "bad" };
}

export function smoothWord(score: number | null): { word: string; tone: Tone } {
  if (score === null) return { word: "Not tested", tone: "off" };
  if (score >= 85) return { word: "Very smooth", tone: "good" };
  if (score >= 65) return { word: "Smooth", tone: "good" };
  if (score >= 40) return { word: "Some hiccups", tone: "warn" };
  return { word: "Stuttery", tone: "bad" };
}

export const toneText: Record<Tone, string> = {
  good: "text-success",
  warn: "text-warn",
  bad: "text-crimson-400",
  off: "text-slate-muted",
};
