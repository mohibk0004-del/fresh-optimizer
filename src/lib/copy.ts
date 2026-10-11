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
  { id: "game", title: "Games", blurb: "Your games get the CPU first", cats: ["game"] },
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
