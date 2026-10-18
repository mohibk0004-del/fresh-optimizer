// Browser-only stand-in for the Rust backend so the UI can be developed with
// `npm run dev` outside Tauri. Never bundled into decisions the real app makes.
import type { EngineEvent, EngineStatus, DisplayInfo, FpsSession, GameAdvice, MatchReport, PcChecks, FpsStatus, GameInfo, PingStats, SystemSnapshot, TweakInfo, TweakResult } from "./types";

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

let engine: EngineStatus = { running: false, activeGames: [], timerHeld: false, powerSchemeActive: false, hogs: [], server: null, gpu: null, serverNote: null };
let applied = new Set<string>();

/** `?ingame=1`: pretend CS2 is running, to design and check the in-match views. */
function inGame(): EngineStatus | null {
  if (!new URLSearchParams(location.search).get("ingame")) return null;
  const history = Array.from({ length: 40 }, (_, i) => (i === 27 ? null : 18 + Math.round(Math.sin(i / 3) * 2 + Math.random() * 2)));
  return {
    running: true,
    activeGames: [{ pid: 4242, game: "Counter-Strike 2", exe: "cs2.exe", enforce: { pid: 4242, exe: "cs2.exe", prioritySet: true, affinitySet: null, note: null } }],
    timerHeld: true,
    powerSchemeActive: true,
    hogs: [{ pid: 777, exe: "chrome.exe", cpuPct: 14.2, diskMbps: 0, protected: false, lowered: false }],
    server: { endpoint: { ip: "155.133.248.39", port: 27031, udp: true, packetsPerSec: 128 }, pingMs: history.at(-1) ?? null, answersPing: true, history },
    gpu: { name: "NVIDIA GeForce RTX 4080 SUPER", tempC: 71, clockMhz: 2715, powerW: 248, loadPct: 92, thermalLimited: false, powerLimited: true },
    serverNote: null,
  };
}

let reports: MatchReport[] = [];
const listeners = new Set<(e: EngineEvent) => void>();

const g = (id: string, name: string, kind: "competitive" | "story", store: string | null, exe = ""): GameInfo => ({
  id,
  name,
  kind,
  store,
  installed: !!store,
  exePaths: exe ? [exe] : [],
  running: false,
  pid: null,
  priority: null,
});
const games: GameInfo[] = [
  g("valorant", "VALORANT", "competitive", "Riot", "C:\\Riot Games\\VALORANT\\live\\ShooterGame\\Binaries\\Win64\\VALORANT-Win64-Shipping.exe"),
  g("cs2", "Counter-Strike 2", "competitive", "Steam", "D:\\SteamLibrary\\steamapps\\common\\Counter-Strike Global Offensive\\game\\bin\\win64\\cs2.exe"),
  g("apex", "Apex Legends", "competitive", null),
  g("overwatch", "Overwatch 2", "competitive", "Battle.net", "C:\\Program Files (x86)\\Overwatch\\_retail_\\Overwatch.exe"),
  g("marvel_rivals", "Marvel Rivals", "competitive", "Steam", "D:\\SteamLibrary\\steamapps\\common\\MarvelRivals\\MarvelGame\\Marvel\\Binaries\\Win64\\Marvel-Win64-Shipping.exe"),
  g("deadlock", "Deadlock", "competitive", null),
  g("fortnite", "Fortnite", "competitive", "Epic Games", "C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe"),
  g("r6siege", "Rainbow Six Siege", "competitive", null),
  g("league", "League of Legends", "competitive", null),
  g("pubg", "PUBG: Battlegrounds", "competitive", null),
  g("rocket_league", "Rocket League", "competitive", null),
  g("dota2", "Dota 2", "competitive", null),
  g("spiderman2", "Marvel's Spider-Man 2", "story", "Steam", "D:\\SteamLibrary\\steamapps\\common\\Marvel's Spider-Man 2\\Spider-Man2.exe"),
  g("spiderman_remastered", "Marvel's Spider-Man Remastered", "story", null),
  g("spiderman_miles", "Marvel's Spider-Man: Miles Morales", "story", "Steam", "D:\\SteamLibrary\\steamapps\\common\\Marvel's Spider-Man Miles Morales\\MilesMorales.exe"),
  g("god_of_war", "God of War", "story", null),
  g("gow_ragnarok", "God of War Ragnarök", "story", "Steam", "D:\\SteamLibrary\\steamapps\\common\\God of War Ragnarok\\GoWR.exe"),
  g("cyberpunk", "Cyberpunk 2077", "story", "GOG", "C:\\GOG Games\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe"),
  g("elden_ring", "Elden Ring", "story", null),
  g("rdr2", "Red Dead Redemption 2", "story", null),
  g("gta5", "Grand Theft Auto V", "story", null),
  g("hogwarts", "Hogwarts Legacy", "story", null),
  g("tlou1", "The Last of Us Part I", "story", null),
  g("horizon_fw", "Horizon Forbidden West", "story", null),
  g("wukong", "Black Myth: Wukong", "story", null),
  g("ghost_tsushima", "Ghost of Tsushima", "story", null),
  g("bg3", "Baldur's Gate 3", "story", null),
  g("alan_wake2", "Alan Wake 2", "story", null),
];

const day = 86400;
const now = Math.floor(Date.now() / 1000);
const sess = (gameId: string, game: string, ago: number, minutes: number, avg: number, low1: number, low01: number, stutters: number, boosted: boolean): FpsSession => ({
  gameId,
  game,
  started: now - ago,
  seconds: minutes * 60,
  frames: Math.round(minutes * 60 * avg),
  avgFps: avg,
  low1Fps: low1,
  low01Fps: low01,
  medianMs: Math.round((100000 / avg) * 1.0) / 100,
  stutters,
  boosted,
});
let fps: FpsStatus = {
  installed: true,
  version: "2.6.0",
  enabled: true,
  capturing: [],
  sessions: [
    sess("cs2", "Counter-Strike 2", 6 * day, 38, 412.3, 178.4, 96.2, 41, false),
    sess("cs2", "Counter-Strike 2", 5 * day, 45, 398.9, 171.0, 88.5, 52, false),
    sess("valorant", "VALORANT", 4 * day, 33, 356.1, 162.7, 101.3, 18, false),
    sess("cs2", "Counter-Strike 2", 2 * day, 41, 421.6, 205.9, 121.4, 22, true),
    sess("cs2", "Counter-Strike 2", 1 * day, 52, 417.2, 199.3, 117.8, 19, true),
    sess("spiderman2", "Marvel's Spider-Man 2", 8 * 3600, 94, 97.4, 71.2, 54.0, 12, true),
  ],
};

const advice: Record<string, GameAdvice> = {
  cs2: {
    file: "C:\\Program Files (x86)\\Steam\\userdata\\1\\730\\local\\cfg\\cs2_video.txt",
    saved: now - 2 * day,
    checks: [
      { name: "VSync", value: "Off", ok: true, tip: null },
      { name: "Display mode", value: "Fullscreen", ok: true, tip: null },
      { name: "Refresh rate", value: "60 Hz", ok: false, tip: "The game is set to 60 Hz but your screen can do 165 Hz. Pick 165 Hz in its video settings." },
      { name: "NVIDIA Reflex", value: "Off", ok: false, tip: "Turn on NVIDIA Reflex (On, or On + Boost) in the game's video settings. It cuts the queue of frames waiting for your GPU, so clicks show up sooner." },
    ],
  },
  valorant: {
    file: "C:\\Users\\you\\AppData\\Local\\VALORANT\\Saved\\Config\\abc\\Windows\\GameUserSettings.ini",
    saved: now - 5 * day,
    checks: [{ name: "Display mode", value: "Fullscreen", ok: true, tip: null }],
  },
};

reports = [
  {
    gameId: "cs2",
    game: "Counter-Strike 2",
    started: now - 1 * day,
    seconds: 52 * 60,
    boosted: true,
    fps: fps.sessions[4],
    server: { ip: "155.133.248.39", port: 27031, udp: true, answersPing: true, avgMs: 19.4, minMs: 17.1, maxMs: 41.0, jitterMs: 1.2, lossPct: 0.3, samples: 1560 },
    gpu: { name: "NVIDIA GeForce RTX 4080 SUPER", maxTempC: 74, avgTempC: 69.5, avgClockMhz: 2701, avgLoadPct: 88, thermalPct: 0, powerPct: 41, samples: 1560 },
    hogs: [{ exe: "chrome.exe", maxCpuPct: 14.2, maxDiskMbps: 0 }],
  },
  {
    gameId: "valorant",
    game: "VALORANT",
    started: now - 4 * day,
    seconds: 33 * 60,
    boosted: false,
    fps: fps.sessions[2],
    server: { ip: "185.40.64.120", port: 7086, udp: true, answersPing: false, avgMs: null, minMs: null, maxMs: null, jitterMs: null, lossPct: null, samples: 990 },
    gpu: { name: "NVIDIA GeForce RTX 4080 SUPER", maxTempC: 86, avgTempC: 83.1, avgClockMhz: 2490, avgLoadPct: 97, thermalPct: 12, powerPct: 64, samples: 990 },
    hogs: [],
  },
];

let displays: DisplayInfo[] = [
  { device: "DISPLAY1", monitor: "Display 1", primary: true, width: 2560, height: 1440, currentHz: 60, maxHz: 165, rates: [60, 120, 144, 165] },
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
      engine = { running: false, activeGames: [], timerHeld: false, powerSchemeActive: false, hogs: [], server: null, gpu: null, serverNote: null };
      return r({ restored: n, failed: [], nicRestarted: true });
    }
    case "engine_start":
      await sleep(200);
      engine = { ...engine, running: true };
      return r(inGame() ?? engine);
    case "engine_stop":
      await sleep(200);
      engine = { running: false, activeGames: [], timerHeld: false, powerSchemeActive: false, hogs: [], server: null, gpu: null, serverNote: null };
      return r(engine);
    case "engine_status":
      return r(inGame() ?? engine);
    case "match_reports":
      return r(reports);
    case "clear_match_reports":
      reports = [];
      return r(undefined);
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
      return r("0.6.0");
    case "fps_status":
      return r(fps);
    case "fps_install":
      await sleep(1800);
      fps = { ...fps, installed: true };
      return r(fps);
    case "fps_uninstall":
      fps = { ...fps, installed: false };
      return r(fps);
    case "fps_clear":
      fps = { ...fps, sessions: [] };
      return r(fps);
    case "hog_lower":
    case "hog_close":
    case "set_agent_settings":
      return r(undefined);
    case "game_advice":
      return r(advice);
    case "health_check": {
      await sleep(1200);
      const checks: PcChecks = {
        wifi: null,
        wired: true,
        driver: { gpu: "NVIDIA GeForce RTX 4080 SUPER", vendor: "NVIDIA", version: "32.0.15.6094", retail: "560.94", date: "2025-08-13", ageDays: 431, downloadUrl: "https://www.nvidia.com/en-us/drivers/" },
        overlays: [{ name: "Discord", note: "Its in-game overlay can cost a little FPS. Turn it off in Discord: User Settings > Game Overlay." }],
        items: [
          { id: "refresh", level: "fix", title: "Display 1 runs at 60 Hz, not 165 Hz", detail: "You're seeing fewer frames than your screen can show. Fix it in one click.", go: "pc" },
          { id: "game", level: "fix", title: "Counter-Strike 2: Refresh rate, NVIDIA Reflex adding lag", detail: "See the tips on its card on the Games page.", go: "games" },
          { id: "driver", level: "worth", title: "Graphics driver is 14 months old", detail: "New drivers often include fixes and optimisations for recent games. Get it from the official site.", go: "pc" },
          { id: "dvr", level: "worth", title: "Background recording is on", detail: "Xbox Game Bar records the last minutes of gameplay all the time. Boost turns this off.", go: "tweaks" },
          { id: "overlay", level: "worth", title: "Discord is running", detail: "Its in-game overlay can cost a little FPS. Turn it off in Discord: User Settings > Game Overlay.", go: null },
          { id: "xmp", level: "fine", title: "Memory runs at 6000 MT/s with XMP/EXPO", detail: "", go: null },
          { id: "wifi", level: "fine", title: "Wired connection", detail: "", go: null },
          { id: "game", level: "fine", title: "VALORANT: in-game settings look good", detail: "", go: null },
        ],
      };
      return r(checks);
    }
    case "open_driver_page":
      return r(undefined);
    case "restore_entries":
      return r(
        [...applied].flatMap((id) => [
          { tweak: id, what: `HKLM\\SOFTWARE\\Example\\${id}`, before: "(not set)", now: "1" },
        ]),
      );
    case "undo_tweak": {
      const ids = args?.id === "power_scheme" || args?.id === "cstate_lock" ? ["power_scheme", "cstate_lock"] : [String(args?.id)];
      ids.forEach((i) => applied.delete(i));
      return r([ids, { restored: ids.length, failed: [], nicRestarted: false }]);
    }
    case "export_setup":
      return r("C:\Users\you\Documents\FreshOptimizer-setup.json");
    case "list_displays":
      return r(displays);
    case "set_refresh_rate":
      displays = displays.map((d) => (d.device === args?.device ? { ...d, currentHz: Number(args?.hz) } : d));
      return r(displays.find((d) => d.device === args?.device));
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
