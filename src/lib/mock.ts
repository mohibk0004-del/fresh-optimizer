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
  { id: "tcp_coalescing", name: "Receive Segment Coalescing off", category: "network", description: "RSC + packet coalescing off", defaultOn: true, caution: "Brief NIC reconnect" },
  { id: "tcp_heuristics", name: "Window scaling heuristics off", category: "network", description: "netsh heuristics disabled", defaultOn: true, caution: null },
  { id: "tcp_cubic", name: "CUBIC congestion control", category: "network", description: "congestionprovider=cubic", defaultOn: true, caution: null },
  { id: "dns_priority", name: "Host resolution priority", category: "network", description: "ServiceProvider order", defaultOn: true, caution: null },
  { id: "sys_responsiveness", name: "Less CPU reserved for background", category: "system", description: "SystemResponsiveness=10", defaultOn: true, caution: null },
  { id: "telemetry_services", name: "Telemetry services off", category: "system", description: "DiagTrack, dmwappushservice", defaultOn: true, caution: null },
  { id: "menu_delay", name: "No menu delay", category: "system", description: "MenuShowDelay=0", defaultOn: true, caution: null },
  { id: "widgets_off", name: "Widgets and news off", category: "system", description: "AllowNewsAndInterests=0", defaultOn: false, caution: null },
  { id: "background_apps", name: "Stop Store apps in background", category: "system", description: "LetAppsRunInBackground=2", defaultOn: false, caution: "Store apps lose live notifications" },
  { id: "sysmain_off", name: "SysMain (Superfetch) off", category: "system", description: "SysMain disabled", defaultOn: false, caution: "Apps may open slower" },
  { id: "mouse_accel_off", name: "Mouse acceleration off", category: "game", description: "Enhance pointer precision off", defaultOn: false, caution: "Desktop mouse feel changes" },
  { id: "sticky_keys_off", name: "Sticky Keys shortcut off", category: "game", description: "No Shift x5 pop-up", defaultOn: true, caution: null },
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

const gamePrefs: Record<string, { enabled: boolean; priority: "high" | "aboveNormal"; fastCores: boolean }> = {
  valorant: { enabled: true, priority: "high", fastCores: true },
  cs2: { enabled: true, priority: "high", fastCores: true },
  apex: { enabled: true, priority: "high", fastCores: true },
  overwatch: { enabled: false, priority: "aboveNormal", fastCores: true },
};

const nicProps = [
  { keyword: "*EEE", displayName: "Energy-Efficient Ethernet", value: "1", validValues: ["0", "1"] },
  { keyword: "EnableGreenEthernet", displayName: "Green Ethernet", value: "0", validValues: ["0", "1"] },
  { keyword: "*InterruptModeration", displayName: "Interrupt Moderation", value: "1", validValues: ["0", "1"] },
  { keyword: "*RSS", displayName: "Receive Side Scaling", value: "1", validValues: ["0", "1"] },
  { keyword: "*LsoV2IPv4", displayName: "Large Send Offload v2 (IPv4)", value: "1", validValues: ["0", "1"] },
];

const dns = {
  adapter: "Ethernet",
  current: "auto",
  servers: [] as string[],
  effectiveServers: ["192.168.1.1"],
  currentLookupMs: 18.3 as number | null,
  options: [
    { id: "auto", name: "Automatic", servers: [] as string[], lookupMs: null as number | null },
    { id: "cloudflare", name: "Cloudflare", servers: ["1.1.1.1", "1.0.0.1"], lookupMs: 4.6 as number | null },
    { id: "google", name: "Google", servers: ["8.8.8.8", "8.8.4.4"], lookupMs: 31.2 as number | null },
    { id: "quad9", name: "Quad9", servers: ["9.9.9.9", "149.112.112.112"], lookupMs: 22.4 as number | null },
  ],
};

const startup = [
  ["Discord", "userRun", String.raw`C:\Users\me\AppData\Local\Discord\Update.exe`, true],
  ["Steam", "userRun", String.raw`C:\Program Files (x86)\Steam\steam.exe`, true],
  ["EpicGamesLauncher", "userRun", String.raw`C:\Program Files (x86)\Epic Games\Launcher\EpicGamesLauncher.exe`, true],
  ["OneDrive", "userRun", String.raw`C:\Program Files\Microsoft OneDrive\OneDrive.exe`, false],
  ["Spotify", "userRun", String.raw`C:\Users\me\AppData\Roaming\Spotify\Spotify.exe`, true],
  ["Riot Vanguard", "machineRun", String.raw`C:\Program Files\Riot Vanguard\vgtray.exe`, true],
  ["SecurityHealth", "machineRun", String.raw`C:\Windows\system32\SecurityHealthSystray.exe`, true],
].map(([display, source, command, enabled]) => ({
  name: display as string, display: display as string, command: command as string, source: source as string,
  allUsers: source === "machineRun", enabled: enabled as boolean,
}));

let launchAtStartup = false;
let latRun = 0;
let timerMode: "off" | "match" | "always" = "match";
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
      latRun++;
      return r({ durationMs: 4100, typicalUs: 27 + (latRun % 3), maxUs: latRun % 2 ? 152.4 : 46, rangeLowUs: 17.4, rangeHighUs: latRun % 2 ? 152.4 : 46, longStallsPerSec: 0, burstWindows: latRun % 2, windowsTotal: 16, over100us: latRun % 2, stolenPct: 0.06, score: 95 + (latRun % 2), verdict: "Very smooth" });
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
        ["Cloudflare", "1.1.1.1", 9.8, 0.6, 0, "edge"],
        ["Google", "8.8.8.8", 12.4, 0.9, 0, "edge"],
        ["CS2 relay \u00b7 Dubai", "185.25.183.163", 38.2, 1.1, 0, "valve_relay"],
        ["Riot network (website)", "riotgames.com", 24.1, 4.8, 5, "riot_web"],
      ].map(([label, host, avg, jit, loss, kind]) => ({
        label: label as string, host: host as string, kind: kind as string, resolved: host as string, sent: 20, received: 20 - (loss as number) / 5,
        lossPct: loss as number, minMs: (avg as number) - 1.2, avgMs: avg as number, maxMs: (avg as number) + 4.1, jitterMs: jit as number, error: null,
      }));
      return r(rows);
    }
    case "flush_dns":
      await sleep(300);
      return r("Successfully flushed the DNS Resolver Cache.");
    case "reset_winsock":
      await sleep(400);
      return r("Winsock catalog reset. Restart Windows to complete.");
    case "get_game_prefs":
      return r(gamePrefs);
    case "set_game_prefs":
      gamePrefs[String(args?.id)] = args?.prefs as (typeof gamePrefs)[string];
      return r(undefined);
    case "launch_game":
      await sleep(400);
      return r("Starting through Steam");
    case "open_game_folder":
      return r(undefined);
    case "nic_properties":
      return r(nicProps);
    case "set_nic_setting": {
      await sleep(1200);
      const p = nicProps.find((x) => x.keyword === args?.keyword);
      if (p) p.value = String(args?.value);
      return r(nicProps);
    }
    case "restart_adapter":
      await sleep(1500);
      return r("Ethernet");
    case "dns_status":
      await sleep(args?.measure ? 900 : 100);
      return r({ ...dns, currentLookupMs: args?.measure ? dns.currentLookupMs : null, options: dns.options.map((o) => ({ ...o, lookupMs: args?.measure ? o.lookupMs : null })) });
    case "set_dns": {
      await sleep(700);
      const o = dns.options.find((x) => x.id === args?.preset)!;
      dns.current = o.id;
      dns.servers = o.servers;
      return r({ ...dns });
    }
    case "list_startup":
      await sleep(200);
      return r(startup);
    case "set_startup": {
      const it = startup.find((x) => x.source === args?.source && x.name === args?.name);
      if (it) it.enabled = Boolean(args?.enabled);
      return r(undefined);
    }
    case "open_settings":
      return r(undefined);
    case "check_update":
      await sleep(900);
      return r({ current: "0.2.0", latest: "0.3.0", available: true, notes: "Themes, settings and auto-updates.", publishedAt: new Date().toISOString(), pageUrl: "https://github.com/mohibk0004-del/fresh-optimizer/releases", downloadUrl: "https://github.com/mohibk0004-del/fresh-optimizer/releases/download/v0.3.0/FreshOptimizer-Setup-0.3.0.exe", sizeBytes: 6900000 });
    case "install_update":
      await sleep(2000);
      return r(undefined);
    case "get_launch_at_startup":
      return r(launchAtStartup);
    case "set_launch_at_startup":
      await sleep(300);
      launchAtStartup = Boolean(args?.enabled);
      return r(launchAtStartup);
    case "open_project_url":
    case "open_data_folder":
      return r(undefined);
    case "app_version":
      return r("0.5.1");
    case "get_timer":
      return r({ mode: timerMode, globalAllowed: false, status: { currentMs: timerMode === "always" ? 0.5 : 15.625, finestMs: 0.5, coarsestMs: 15.625, heldByApp: timerMode === "always" } });
    case "set_timer_mode":
      timerMode = args?.mode as typeof timerMode;
      return r({ mode: timerMode, globalAllowed: false, status: { currentMs: timerMode === "always" ? 0.5 : 15.625, finestMs: 0.5, coarsestMs: 15.625, heldByApp: timerMode === "always" } });
    case "trace_route": {
      await sleep(2500);
      const host = String(args?.host);
      const bad = host === "riotgames.com";
      const hop = (ttl: number, address: string | null, avg: number | null, jit: number | null, loss: number, extra: Partial<{ private: boolean; cgnat: boolean; isDestination: boolean }> = {}) => ({
        ttl, address, sent: 6, received: address ? Math.round(6 * (1 - loss / 100)) : 0, lossPct: address ? loss : 100, avgMs: avg, bestMs: avg && avg - 0.5, worstMs: avg && avg + (jit ?? 0) * 3, jitterMs: jit,
        private: false, cgnat: false, isDestination: false, ...extra,
      });
      return r({
        host, resolved: host, reached: true, error: null,
        hops: [
          hop(1, "192.168.1.1", 1.1, bad ? 6.2 : 0.3, 0, { private: true }),
          hop(2, "100.72.0.1", 4.2, bad ? 5.9 : 0.4, 0, { cgnat: true }),
          hop(3, "154.192.100.1", 5.0, 0.5, 0),
          hop(4, null, null, null, 100),
          hop(5, "203.175.65.67", 9.6, 0.6, bad ? 33 : 0),
          hop(6, host, bad ? 24.1 : 9.8, bad ? 4.8 : 0.6, bad ? 5 : 0, { isDestination: true }),
        ],
      });
    }
    case "game_icons":
      return r({});
    case "set_wallpaper":
    case "clear_wallpaper":
      return r(undefined);
    case "get_wallpaper":
      return r(null);
    default:
      throw new Error(`mock: unknown command ${cmd}`);
  }
}
