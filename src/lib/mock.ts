// Browser-only stand-in for the Rust backend so the UI can be developed with
// `npm run dev` outside Tauri. Never bundled into decisions the real app makes.
import type { EngineEvent, EngineStatus, GameInfo, PingStats, SystemSnapshot, TweakInfo, TweakResult } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const tweaks: TweakInfo[] = [
  { id: "nagle", name: "Disable Nagle's Algorithm", category: "network", description: "TcpAckFrequency=1, TCPNoDelay=1", defaultOn: true, caution: null },
  { id: "net_throttling", name: "Remove Network Throttling", category: "network", description: "NetworkThrottlingIndex=0xFFFFFFFF", defaultOn: true, caution: null },
  { id: "tcp_autotuning", name: "TCP Auto-Tuning: Normal", category: "network", description: "netsh autotuninglevel=normal", defaultOn: true, caution: null },
  { id: "nic_eee", name: "Disable EEE / Green Ethernet", category: "nic", description: "Link power saving off", defaultOn: true, caution: "Brief NIC reconnect" },
  { id: "nic_interrupt", name: "Disable Interrupt Moderation", category: "nic", description: "No packet batching", defaultOn: true, caution: "Brief NIC reconnect" },
  { id: "nic_rss_lso", name: "RSS On / LSO Off", category: "nic", description: "Spread receive, no LSO bursts", defaultOn: true, caution: "Brief NIC reconnect" },
  { id: "gamedvr", name: "Disable Game DVR / Capture", category: "system", description: "Xbox capture hooks off", defaultOn: true, caution: null },
  { id: "game_mode", name: "Enable Windows Game Mode", category: "system", description: "Foreground priority", defaultOn: true, caution: null },
  { id: "mmcss_games", name: "MMCSS Games Profile", category: "system", description: "Scheduling High, GPU 8", defaultOn: true, caution: null },
  { id: "global_timer", name: "Allow Global Timer Resolution", category: "system", description: "Win11 global timer", defaultOn: true, caution: null },
  { id: "fso", name: "Disable Fullscreen Optimizations", category: "game", description: "Per-binary flag", defaultOn: true, caution: null },
  { id: "ifeo_priority", name: "Launch-Time High Priority", category: "game", description: "IFEO CpuPriorityClass", defaultOn: true, caution: null },
  { id: "power_scheme", name: "Low-DPC Power Scheme", category: "power", description: "No core parking", defaultOn: true, caution: null },
  { id: "cstate_lock", name: "Lock Out CPU Idle States", category: "power", description: "C-states off in-match", defaultOn: false, caution: "High temps / power draw" },
];

const system: SystemSnapshot = {
  isAdmin: false,
  profile: {
    cpu: { name: "Intel(R) Core(TM) i7-14700K", maxClockMhz: 3400 },
    topology: { physicalCores: 20, logicalThreads: 28, hybrid: true, pCores: 8, eCores: 12, pCoreMask: 65535, fullMask: 268435455 },
    gpus: [{ name: "NVIDIA GeForce RTX 4080 SUPER", vramBytes: 17171480576, driverVersion: "32.0.15.6614" }],
    ram: { totalBytes: 34359738368, modules: 2, ratedMhz: 4800, configuredMhz: 6000, smbiosType: 34 },
    ramType: "DDR5",
    xmpLikely: true,
    nic: { name: "Ethernet", description: "Intel(R) Ethernet Controller I226-V", driverVersion: "2.1.4.3", linkSpeed: "2.5 Gbps", media: "802.3", interfaceGuid: "{00000000-0000-0000-0000-000000000000}", ifIndex: 12 },
  },
  live: { timer: { currentMs: 15.625, finestMs: 0.5, coarsestMs: 15.625, heldByApp: false }, hagsEnabled: true, gameModeEnabled: true, gameDvrEnabled: true },
};

let engine: EngineStatus = { running: false, activeGames: [], timerHeld: false, powerSchemeActive: false };
let applied = new Set<string>();
const listeners = new Set<(e: EngineEvent) => void>();

const games: GameInfo[] = [
  { id: "valorant", name: "VALORANT", installed: true, exePaths: ["C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe"], running: false, pid: null, priority: null },
  { id: "cs2", name: "Counter-Strike 2", installed: true, exePaths: ["D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe"], running: false, pid: null, priority: null },
  { id: "apex", name: "Apex Legends", installed: false, exePaths: [], running: false, pid: null, priority: null },
  { id: "overwatch", name: "Overwatch 2", installed: true, exePaths: ["C:\\Program Files (x86)\\Overwatch\\_retail_\\Overwatch.exe"], running: false, pid: null, priority: null },
];

let base = 14;
function fakeRtt() {
  base += (Math.random() - 0.5) * 0.6;
  base = Math.min(22, Math.max(9, base));
  const spike = Math.random() < 0.04 ? Math.random() * 18 : 0;
  return Math.round((base + Math.random() * 2.2 + spike) * 100) / 100;
}

export function onEngineEvent(cb: (e: EngineEvent) => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function handle<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const r = (v: unknown) => v as T;
  switch (cmd) {
    case "get_system_info":
      await sleep(600);
      return r({ ...system, live: { ...system.live, timer: { ...system.live.timer, currentMs: engine.timerHeld ? 0.5 : 15.625, heldByApp: engine.timerHeld } } });
    case "measure_latency":
      await sleep(700);
      return r({ windowMs: 300, interruptions: 24, medianUs: 6.4, p99Us: 31.2, maxUs: 41.8, over100us: 0, stolenPct: 0.06, score: 96, verdict: "Excellent" });
    case "get_games":
      await sleep(300);
      return r(games);
    case "list_tweaks":
      return r(tweaks);
    case "apply_tweak": {
      const id = String(args?.id);
      await sleep(350 + Math.random() * 450);
      applied.add(id);
      const res: TweakResult =
        id === "fso"
          ? { id, status: "applied", detail: "3 game binaries flagged", needsNicRestart: false }
          : id === "tcp_autotuning"
            ? { id, status: "skipped", detail: "Already 'normal'", needsNicRestart: false }
            : { id, status: "applied", detail: "Applied", needsNicRestart: id.startsWith("nic_") };
      return r(res);
    }
    case "finalize_boost":
      await sleep(900);
      return r("Ethernet");
    case "restore_summary":
      return r({ exists: applied.size > 0, path: "%APPDATA%\\com.freshoptimizer.app\\RestorePoint.json", createdAt: Date.now() / 1000, entryCount: applied.size * 2, appliedTweaks: [...applied] });
    case "rollback": {
      await sleep(900);
      const n = applied.size * 2;
      applied = new Set();
      engine = { running: false, activeGames: [], timerHeld: false, powerSchemeActive: false };
      return r({ restored: n, failed: [], nicRestarted: true });
    }
    case "engine_start":
      await sleep(200);
      engine = { ...engine, running: true };
      return r(engine);
    case "engine_stop":
      await sleep(200);
      engine = { running: false, activeGames: [], timerHeld: false, powerSchemeActive: false };
      return r(engine);
    case "engine_status":
      return r(engine);
    case "ping_once":
      await sleep(30);
      return r(Math.random() < 0.01 ? null : fakeRtt());
    case "ping_probe": {
      await sleep(2000);
      const rows: PingStats[] = [
        ["Cloudflare Edge", "1.1.1.1", 9.8, 0.6, 0],
        ["Google Edge", "8.8.8.8", 12.4, 0.9, 0],
        ["Riot Games", "riotgames.com", 24.1, 1.8, 0],
        ["Valve / Steam", "steampowered.com", 31.7, 2.4, 5],
      ].map(([label, host, avg, jit, loss]) => ({
        label: label as string, host: host as string, resolved: host as string, sent: 20, received: 20 - (loss as number) / 5,
        lossPct: loss as number, minMs: (avg as number) - 1.2, avgMs: avg as number, maxMs: (avg as number) + 4.1, jitterMs: jit as number, error: null,
      }));
      return r(rows);
    }
    case "nic_properties":
      return r([]);
    case "flush_dns":
      await sleep(300);
      return r("Successfully flushed the DNS Resolver Cache.");
    case "reset_winsock":
      await sleep(400);
      return r("Winsock catalog reset. Restart Windows to complete.");
    default:
      throw new Error(`mock: unknown command ${cmd}`);
  }
}
