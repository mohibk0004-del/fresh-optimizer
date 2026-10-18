export interface CpuTopology {
  physicalCores: number;
  logicalThreads: number;
  hybrid: boolean;
  pCores: number;
  eCores: number;
  pCoreMask: number;
  fullMask: number;
}

export interface HardwareProfile {
  cpu: { name: string; maxClockMhz: number };
  topology: CpuTopology;
  gpus: { name: string; vramBytes: number; driverVersion: string }[];
  ram: { totalBytes: number; modules: number; ratedMhz: number; configuredMhz: number; smbiosType: number };
  ramType: string;
  xmpLikely: boolean;
  nic: NicInfo | null;
}

export interface NicInfo {
  name: string;
  description: string;
  driverVersion: string;
  linkSpeed: string;
  media: string;
  interfaceGuid: string;
  ifIndex: number;
}

export interface TimerStatus {
  currentMs: number;
  finestMs: number;
  coarsestMs: number;
  heldByApp: boolean;
}

export interface LiveStatus {
  timer: TimerStatus;
  hagsEnabled: boolean | null;
  gameModeEnabled: boolean;
  gameDvrEnabled: boolean;
}

export interface SystemSnapshot {
  profile: HardwareProfile;
  live: LiveStatus;
  isAdmin: boolean;
}

export interface LatencyReport {
  durationMs: number;
  /** Median of each short window's worst stall: a normal moment. */
  typicalUs: number;
  maxUs: number;
  rangeLowUs: number;
  rangeHighUs: number;
  longStallsPerSec: number;
  burstWindows: number;
  windowsTotal: number;
  over100us: number;
  stolenPct: number;
  score: number;
  verdict: string;
}

export type GameKind = "competitive" | "story";

export interface GameInfo {
  id: string;
  name: string;
  kind: GameKind;
  /** Where it was found: "Steam", "Epic Games", "GOG", "Riot", "Battle.net", "EA app", "Ubisoft Connect". */
  store: string | null;
  installed: boolean;
  exePaths: string[];
  running: boolean;
  pid: number | null;
  priority: string | null;
}

export type TweakCategory = "network" | "nic" | "system" | "game" | "power";

export interface TweakInfo {
  id: string;
  name: string;
  category: TweakCategory;
  description: string;
  defaultOn: boolean;
  caution: string | null;
}

export type TweakStatus = "applied" | "skipped" | "failed";

export interface TweakResult {
  id: string;
  status: TweakStatus;
  detail: string;
  needsNicRestart: boolean;
}

export interface RestoreSummary {
  exists: boolean;
  path: string;
  createdAt: number;
  entryCount: number;
  appliedTweaks: string[];
}

export interface RollbackReport {
  restored: number;
  failed: string[];
  nicRestarted: boolean;
}

export interface EnforceResult {
  pid: number;
  exe: string;
  prioritySet: boolean;
  affinitySet: boolean | null;
  note: string | null;
}

export interface ActiveGame {
  pid: number;
  game: string;
  exe: string;
  enforce: EnforceResult;
}

export interface EngineStatus {
  running: boolean;
  activeGames: ActiveGame[];
  timerHeld: boolean;
  powerSchemeActive: boolean;
}

export type EngineEvent =
  | { type: "gameStarted"; game: ActiveGame }
  | { type: "gameExited"; pid: number; game: string }
  | { type: "matchMode"; active: boolean; timerMs: number };

export interface PingTarget {
  label: string;
  host: string;
}

export type TargetKind = "edge" | "valve_relay" | "riot_web" | string;

export interface PingStats {
  label: string;
  host: string;
  kind: TargetKind;
  resolved: string | null;
  sent: number;
  received: number;
  lossPct: number;
  minMs: number;
  avgMs: number;
  maxMs: number;
  jitterMs: number;
  error: string | null;
}

export interface NicProperty {
  keyword: string;
  displayName: string;
  value: string;
  validValues: string[];
}

export type GamePriority = "high" | "aboveNormal";

export interface GamePrefs {
  enabled: boolean;
  priority: GamePriority;
  fastCores: boolean;
}

export interface DnsOption {
  id: string;
  name: string;
  servers: string[];
  /** Median time of real DNS lookups (not ping). */
  lookupMs: number | null;
}

export interface DnsStatus {
  adapter: string | null;
  current: string;
  servers: string[];
  effectiveServers: string[];
  currentLookupMs: number | null;
  options: DnsOption[];
}

export interface StartupItem {
  name: string;
  display: string;
  command: string;
  source: string;
  allUsers: boolean;
  enabled: boolean;
}

export interface UpdateInfo {
  current: string;
  latest: string;
  available: boolean;
  notes: string;
  publishedAt: string;
  pageUrl: string;
  downloadUrl: string | null;
  sizeBytes: number;
}

export interface Hop {
  ttl: number;
  address: string | null;
  sent: number;
  received: number;
  lossPct: number;
  avgMs: number | null;
  bestMs: number | null;
  worstMs: number | null;
  jitterMs: number | null;
  private: boolean;
  cgnat: boolean;
  isDestination: boolean;
}

export interface Trace {
  host: string;
  resolved: string | null;
  reached: boolean;
  hops: Hop[];
  error: string | null;
}

export type TimerMode = "off" | "match" | "always";

export interface TimerInfo {
  mode: TimerMode;
  status: TimerStatus;
  globalAllowed: boolean;
}
