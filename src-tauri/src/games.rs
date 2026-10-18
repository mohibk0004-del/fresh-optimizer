//! Game discovery (installs via each store's own records, running processes)
//! and the process priority / affinity enforcer.
//!
//! Anti-cheat safety: handles are opened with PROCESS_SET_INFORMATION |
//! PROCESS_QUERY_LIMITED_INFORMATION only. No VM read/write, no threads, no DLLs.
//! If an anti-cheat strips even that, the call fails and we report it cleanly;
//! the persistent IFEO `CpuPriorityClass` tweak still applies High priority at launch.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Threading::{
    GetPriorityClass, OpenProcess, SetPriorityClass, SetProcessAffinityMask, ABOVE_NORMAL_PRIORITY_CLASS,
    BELOW_NORMAL_PRIORITY_CLASS, HIGH_PRIORITY_CLASS, IDLE_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION, REALTIME_PRIORITY_CLASS,
};

use crate::error::{AppError, AppResult};
use crate::prefs::Priority;
use crate::registry::{self, Hive};
use crate::util;
use crate::util::wide_to_string;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Competitive,
    Story,
}

pub struct GameDef {
    pub id: &'static str,
    pub name: &'static str,
    pub kind: Kind,
    /// Steam app id (install found via steamapps/appmanifest_<id>.acf).
    pub steam: Option<u32>,
    /// Display name as shown by the Epic / GOG launchers (matched loosely).
    pub store_name: Option<&'static str>,
    /// Known game binaries (not launchers). Hints only: if none is found in
    /// the install folder, the largest game executable there is used.
    pub processes: &'static [&'static str],
}

macro_rules! game {
    ($id:literal, $name:literal, $kind:ident, $steam:expr, $store:expr, [$($p:literal),*]) => {
        GameDef { id: $id, name: $name, kind: Kind::$kind, steam: $steam, store_name: $store, processes: &[$($p),*] }
    };
}

pub const GAMES: &[GameDef] = &[
    // ---- competitive
    game!("valorant", "VALORANT", Competitive, None, None, ["VALORANT-Win64-Shipping.exe"]),
    game!("cs2", "Counter-Strike 2", Competitive, Some(730), None, ["cs2.exe"]),
    game!("apex", "Apex Legends", Competitive, Some(1172470), Some("Apex Legends"), ["r5apex.exe", "r5apex_dx12.exe"]),
    game!("overwatch", "Overwatch 2", Competitive, Some(2357570), None, ["Overwatch.exe"]),
    game!("marvel_rivals", "Marvel Rivals", Competitive, Some(2767030), Some("Marvel Rivals"), ["Marvel-Win64-Shipping.exe"]),
    game!("deadlock", "Deadlock", Competitive, Some(1422450), None, ["deadlock.exe", "project8.exe"]),
    game!("fortnite", "Fortnite", Competitive, None, Some("Fortnite"), ["FortniteClient-Win64-Shipping.exe"]),
    game!("r6siege", "Rainbow Six Siege", Competitive, Some(359550), None, ["RainbowSix.exe", "RainbowSix_BE.exe", "RainbowSix_Vulkan.exe"]),
    game!("league", "League of Legends", Competitive, None, None, ["League of Legends.exe"]),
    game!("pubg", "PUBG: Battlegrounds", Competitive, Some(578080), None, ["TslGame.exe"]),
    game!("rocket_league", "Rocket League", Competitive, Some(252950), Some("Rocket League"), ["RocketLeague.exe"]),
    game!("dota2", "Dota 2", Competitive, Some(570), None, ["dota2.exe"]),
    // ---- story / single player
    game!("spiderman2", "Marvel's Spider-Man 2", Story, Some(2651280), Some("Marvel's Spider-Man 2"), ["Spider-Man2.exe"]),
    game!("spiderman_remastered", "Marvel's Spider-Man Remastered", Story, Some(1817070), Some("Marvel's Spider-Man Remastered"), ["Spider-Man.exe"]),
    game!("spiderman_miles", "Marvel's Spider-Man: Miles Morales", Story, Some(1817190), Some("Miles Morales"), ["MilesMorales.exe"]),
    game!("god_of_war", "God of War", Story, Some(1593500), Some("God of War"), ["GoW.exe"]),
    game!("gow_ragnarok", "God of War Ragnarök", Story, Some(2322010), Some("God of War Ragnarök"), ["GoWR.exe"]),
    game!("cyberpunk", "Cyberpunk 2077", Story, Some(1091500), Some("Cyberpunk 2077"), ["Cyberpunk2077.exe"]),
    game!("elden_ring", "Elden Ring", Story, Some(1245620), None, ["eldenring.exe"]),
    game!("rdr2", "Red Dead Redemption 2", Story, Some(1174180), Some("Red Dead Redemption 2"), ["RDR2.exe"]),
    game!("gta5", "Grand Theft Auto V", Story, Some(271590), Some("Grand Theft Auto V"), ["GTA5.exe", "GTA5_Enhanced.exe"]),
    game!("hogwarts", "Hogwarts Legacy", Story, Some(990080), Some("Hogwarts Legacy"), ["HogwartsLegacy.exe"]),
    game!("tlou1", "The Last of Us Part I", Story, Some(1888930), Some("The Last of Us Part I"), ["tlou-i.exe"]),
    game!("horizon_fw", "Horizon Forbidden West", Story, Some(2420110), Some("Horizon Forbidden West"), ["HorizonForbiddenWest.exe"]),
    game!("wukong", "Black Myth: Wukong", Story, Some(2358720), Some("Black Myth: Wukong"), ["b1-Win64-Shipping.exe"]),
    game!("ghost_tsushima", "Ghost of Tsushima", Story, Some(2215430), Some("Ghost of Tsushima"), ["GhostOfTsushima.exe"]),
    game!("bg3", "Baldur's Gate 3", Story, Some(1086940), Some("Baldur's Gate 3"), ["bg3.exe", "bg3_dx11.exe"]),
    game!("alan_wake2", "Alan Wake 2", Story, None, Some("Alan Wake 2"), ["AlanWake2.exe"]),
];

pub fn def(id: &str) -> Option<&'static GameDef> {
    GAMES.iter().find(|g| g.id == id)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub id: String,
    pub name: String,
    pub kind: Kind,
    /// "Steam", "Epic Games", "GOG", "Riot", "Battle.net", "EA app", "Ubisoft Connect".
    pub store: Option<String>,
    pub installed: bool,
    pub exe_paths: Vec<String>,
    pub running: bool,
    pub pid: Option<u32>,
    pub priority: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RunningProcess {
    pub pid: u32,
    pub exe: String,
}

pub fn list_processes() -> Vec<RunningProcess> {
    let mut out = Vec::new();
    // SAFETY: snapshot handle is checked and closed; entry has dwSize set.
    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e) != 0 {
            loop {
                out.push(RunningProcess { pid: e.th32ProcessID, exe: wide_to_string(&e.szExeFile) });
                if Process32NextW(snap, &mut e) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
    }
    out
}

// ---------- install discovery ----------

/// How to launch an installed game through its own store, as the signed-in user.
#[derive(Debug, Clone)]
enum Launch {
    Steam(u32),
    Epic(String),
    Riot(&'static str),
    BattleNet(&'static str),
    Exe,
}

#[derive(Debug, Clone)]
struct Install {
    id: &'static str,
    store: &'static str,
    exe: PathBuf,
    launch: Launch,
}

static CACHE: Mutex<Option<(Instant, Vec<Install>)>> = Mutex::new(None);
const CACHE_TTL: Duration = Duration::from_secs(60);

fn steam_libraries() -> Vec<PathBuf> {
    let mut libs = Vec::new();
    let steam = registry::read_string(Hive::CurrentUser, r"Software\Valve\Steam", "SteamPath")
        .or_else(|| registry::read_string(Hive::LocalMachine, r"SOFTWARE\WOW6432Node\Valve\Steam", "InstallPath"));
    let Some(steam) = steam else { return libs };
    let root = PathBuf::from(steam.replace('/', "\\"));
    libs.push(root.clone());
    if let Ok(vdf) = std::fs::read_to_string(root.join(r"steamapps\libraryfolders.vdf")) {
        libs.extend(parse_vdf_paths(&vdf).into_iter().map(PathBuf::from));
    }
    libs.sort();
    libs.dedup_by(|a, b| a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy()));
    libs
}

/// Minimal libraryfolders.vdf reader: collects every `"path"  "<value>"` pair.
pub fn parse_vdf_paths(vdf: &str) -> Vec<String> {
    vdf_values(vdf, "path")
}

/// Every value of `key` in a Valve KeyValues text file (`"key"  "value"` lines).
fn vdf_values(vdf: &str, key: &str) -> Vec<String> {
    vdf.lines()
        .filter_map(|line| {
            let quoted: Vec<&str> = line.split('"').collect();
            if quoted.len() >= 4 && quoted[1].eq_ignore_ascii_case(key) {
                Some(quoted[3].replace("\\\\", "\\"))
            } else {
                None
            }
        })
        .collect()
}

fn steam_dir(libs: &[PathBuf], app: u32) -> Option<PathBuf> {
    libs.iter().find_map(|lib| {
        let acf = std::fs::read_to_string(lib.join("steamapps").join(format!("appmanifest_{app}.acf"))).ok()?;
        let dir = vdf_values(&acf, "installdir").into_iter().next()?;
        let p = lib.join("steamapps").join("common").join(dir);
        p.is_dir().then_some(p)
    })
}

fn norm(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

fn names_match(store_name: &str, wanted: &str) -> bool {
    let (a, b) = (norm(store_name), norm(wanted));
    !a.is_empty() && !b.is_empty() && (a == b || a.contains(&b) || b.contains(&a))
}

struct EpicApp {
    name: String,
    dir: PathBuf,
    exe: Option<PathBuf>,
    launch_id: String,
}

fn epic_apps() -> Vec<EpicApp> {
    let dir = PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into())).join(r"Epic\EpicGamesLauncher\Data\Manifests");
    let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
    rd.filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("item")))
        .filter_map(|e| {
            let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(e.path()).ok()?).ok()?;
            let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
            let dir = PathBuf::from(s("InstallLocation"));
            let exe = (!s("LaunchExecutable").is_empty()).then(|| dir.join(s("LaunchExecutable")));
            let launch_id = format!("{}%3A{}%3A{}", s("CatalogNamespace"), s("CatalogItemId"), s("AppName"));
            Some(EpicApp { name: s("DisplayName"), dir, exe, launch_id })
        })
        .filter(|a| a.dir.is_dir())
        .collect()
}

fn gog_games() -> Vec<(String, PathBuf)> {
    let Ok(root) = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\WOW6432Node\GOG.com\Games") else {
        return Vec::new();
    };
    root.enum_keys()
        .filter_map(|k| k.ok())
        .filter_map(|k| {
            let sub = root.open_subkey(&k).ok()?;
            let name: String = sub.get_value("gameName").ok()?;
            let path: String = sub.get_value("path").ok()?;
            Some((name, PathBuf::from(path)))
        })
        .collect()
}

fn riot_roots(product: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(json) = std::fs::read_to_string(r"C:\ProgramData\Riot Games\RiotClientInstalls.json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
            if let Some(map) = v.get("associated_client").and_then(|m| m.as_object()) {
                for key in map.keys() {
                    let p = PathBuf::from(key.replace('/', "\\"));
                    if norm(&p.to_string_lossy()).contains(&norm(product)) {
                        roots.push(p);
                    }
                }
            }
        }
    }
    let folder = if product == "valorant" { r"VALORANT\live" } else { "League of Legends" };
    for drive in ["C", "D", "E", "F", "G"] {
        roots.push(PathBuf::from(format!(r"{drive}:\Riot Games\{folder}")));
    }
    roots
}

fn program_files() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"].iter().filter_map(|k| std::env::var_os(k).map(PathBuf::from)).collect()
}

/// Folders that never hold the game binary itself.
const SKIP_DIRS: &[&str] = &["redist", "_commonredist", "directx", "easyanticheat", "battleye", "vcredist", "support", "__installer", "crashreportclient"];
/// Executables that are never the game itself.
const SKIP_EXES: &[&str] = &["unins", "crash", "report", "redist", "setup", "launcher", "eac", "battleye", "beservice", "dxsetup", "cefsubprocess", "helper", "update", "vc_", "dotnet", "installer", "prereq", "ue4prereq", "uninstall"];

/// Finds the game binary in an install folder: a known name first, otherwise
/// the largest executable that isn't a launcher, redistributable or tool.
fn find_exe(dir: &Path, hints: &[&str]) -> Option<PathBuf> {
    let mut stack = vec![(dir.to_path_buf(), 0u32)];
    let mut best: Option<(u64, PathBuf)> = None;
    let mut seen = 0usize;
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            seen += 1;
            if seen > 20_000 {
                break;
            }
            let p = e.path();
            let name = e.file_name().to_string_lossy().to_lowercase();
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth < 6 && !SKIP_DIRS.iter().any(|s| name.contains(s)) {
                    stack.push((p, depth + 1));
                }
            } else if name.ends_with(".exe") {
                if hints.iter().any(|h| h.eq_ignore_ascii_case(&name)) {
                    return Some(p);
                }
                if SKIP_EXES.iter().any(|s| name.contains(s)) {
                    continue;
                }
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                if best.as_ref().map_or(true, |(b, _)| size > *b) {
                    best = Some((size, p));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

fn scan() -> Vec<Install> {
    let libs = steam_libraries();
    let epic = epic_apps();
    let gog = gog_games();
    let mut out = Vec::new();
    for g in GAMES {
        let found = (|| {
            if let Some(dir) = g.steam.and_then(|app| steam_dir(&libs, app)) {
                if let Some(exe) = find_exe(&dir, g.processes) {
                    return Some(Install { id: g.id, store: "Steam", exe, launch: Launch::Steam(g.steam.unwrap()) });
                }
            }
            if let Some(want) = g.store_name {
                if let Some(app) = epic.iter().find(|a| names_match(&a.name, want)) {
                    let exe = find_exe(&app.dir, g.processes).or_else(|| app.exe.clone().filter(|e| e.is_file()));
                    if let Some(exe) = exe {
                        return Some(Install { id: g.id, store: "Epic Games", exe, launch: Launch::Epic(app.launch_id.clone()) });
                    }
                }
                if let Some((_, dir)) = gog.iter().find(|(n, _)| names_match(n, want)) {
                    if let Some(exe) = find_exe(dir, g.processes) {
                        return Some(Install { id: g.id, store: "GOG", exe, launch: Launch::Exe });
                    }
                }
            }
            let special: Vec<(PathBuf, &'static str, Launch)> = match g.id {
                "valorant" => riot_roots("valorant").into_iter().map(|d| (d, "Riot", Launch::Riot("valorant"))).collect(),
                "league" => riot_roots("league").into_iter().map(|d| (d, "Riot", Launch::Riot("league_of_legends"))).collect(),
                "overwatch" => program_files().into_iter().map(|p| (p.join("Overwatch"), "Battle.net", Launch::BattleNet("Pro"))).collect(),
                "apex" => program_files().into_iter().map(|p| (p.join(r"EA Games\Apex Legends"), "EA app", Launch::Exe)).collect(),
                "r6siege" => registry::read_string(Hive::LocalMachine, r"SOFTWARE\WOW6432Node\Ubisoft\Launcher\Installs\635", "InstallDir")
                    .map(|d| vec![(PathBuf::from(d), "Ubisoft Connect", Launch::Exe)])
                    .unwrap_or_default(),
                _ => Vec::new(),
            };
            special.into_iter().find_map(|(dir, store, launch)| {
                if !dir.is_dir() {
                    return None;
                }
                find_exe(&dir, g.processes).filter(|e| g.processes.iter().any(|h| e.file_name().is_some_and(|f| f.to_string_lossy().eq_ignore_ascii_case(h)))).map(|exe| Install { id: g.id, store, exe, launch })
            })
        })();
        if let Some(i) = found {
            out.push(i);
        }
    }
    out
}

fn installs() -> Vec<Install> {
    let mut cache = CACHE.lock().unwrap_or_else(|p| p.into_inner());
    if let Some((at, list)) = cache.as_ref() {
        if at.elapsed() < CACHE_TTL {
            return list.clone();
        }
    }
    let list = scan();
    *cache = Some((Instant::now(), list.clone()));
    list
}

/// Executable file names that belong to `g` (known names + the detected one).
fn exe_names(g: &GameDef, installs: &[Install]) -> Vec<String> {
    let mut v: Vec<String> = g.processes.iter().map(|s| s.to_string()).collect();
    if let Some(i) = installs.iter().find(|i| i.id == g.id) {
        if let Some(f) = i.exe.file_name() {
            v.push(f.to_string_lossy().into_owned());
        }
    }
    v
}

/// The catalog game a running executable belongs to.
pub fn game_for_exe(exe: &str) -> Option<&'static GameDef> {
    if let Some(g) = GAMES.iter().find(|g| g.processes.iter().any(|p| p.eq_ignore_ascii_case(exe))) {
        return Some(g);
    }
    let list = installs();
    list.iter()
        .find(|i| i.exe.file_name().is_some_and(|f| f.to_string_lossy().eq_ignore_ascii_case(exe)))
        .and_then(|i| def(i.id))
}

pub fn discover() -> Vec<GameInfo> {
    let list = installs();
    let procs = list_processes();
    GAMES
        .iter()
        .map(|g| {
            let inst = list.iter().find(|i| i.id == g.id);
            let names = exe_names(g, &list);
            let running = procs.iter().find(|p| names.iter().any(|n| n.eq_ignore_ascii_case(&p.exe)));
            GameInfo {
                id: g.id.into(),
                name: g.name.into(),
                kind: g.kind,
                store: inst.map(|i| i.store.to_string()),
                installed: inst.is_some() || running.is_some(),
                exe_paths: inst.map(|i| vec![i.exe.display().to_string()]).unwrap_or_default(),
                running: running.is_some(),
                pid: running.map(|p| p.pid),
                priority: running.and_then(|p| priority_label(p.pid)),
            }
        })
        .collect()
}

pub fn installed_exe_paths() -> Vec<String> {
    installs().into_iter().map(|i| i.exe.display().to_string()).collect()
}

/// Executable names of installed games (for launch-time priority).
pub fn installed_exe_names() -> Vec<String> {
    let list = installs();
    let mut v: Vec<String> = GAMES.iter().filter(|g| list.iter().any(|i| i.id == g.id)).flat_map(|g| exe_names(g, &list)).collect();
    v.sort_by_key(|s| s.to_lowercase());
    v.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    v
}

// ---------- enforcement ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnforceResult {
    pub pid: u32,
    pub exe: String,
    pub priority_set: bool,
    pub affinity_set: Option<bool>,
    pub note: Option<String>,
}

pub fn priority_label(pid: u32) -> Option<String> {
    // SAFETY: limited query handle, closed before return.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let c = GetPriorityClass(h);
        CloseHandle(h);
        Some(
            match c {
                x if x == IDLE_PRIORITY_CLASS => "Idle",
                x if x == BELOW_NORMAL_PRIORITY_CLASS => "Below Normal",
                x if x == NORMAL_PRIORITY_CLASS => "Normal",
                x if x == ABOVE_NORMAL_PRIORITY_CLASS => "Above Normal",
                x if x == HIGH_PRIORITY_CLASS => "High",
                x if x == REALTIME_PRIORITY_CLASS => "Realtime",
                _ => return None,
            }
            .into(),
        )
    }
}

/// Sets the chosen priority class and, when given, restricts affinity to P-cores.
pub fn enforce(pid: u32, exe: &str, priority: Priority, p_core_mask: Option<u64>) -> EnforceResult {
    let mut r = EnforceResult { pid, exe: exe.into(), priority_set: false, affinity_set: None, note: None };
    // SAFETY: minimal-rights handle, checked and closed.
    unsafe {
        let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            r.note = Some("Process is protected (anti-cheat) - using launch-time IFEO priority instead".into());
            return r;
        }
        let class = match priority {
            Priority::High => HIGH_PRIORITY_CLASS,
            Priority::AboveNormal => ABOVE_NORMAL_PRIORITY_CLASS,
        };
        r.priority_set = SetPriorityClass(h, class) != 0;
        if let Some(mask) = p_core_mask.filter(|m| *m != 0) {
            r.affinity_set = Some(SetProcessAffinityMask(h, mask as usize) != 0);
        }
        CloseHandle(h);
    }
    if !r.priority_set {
        r.note = Some(format!("SetPriorityClass denied: {}", std::io::Error::last_os_error()));
    }
    r
}

// ---------- launching ----------

/// Starts a URI or file through Explorer so it runs as the signed-in user,
/// not elevated like FreshOptimizer. Games must never inherit our admin token.
fn open_unelevated(target: &str) -> AppResult<()> {
    std::process::Command::new("explorer.exe")
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|e| AppError::Command(format!("explorer: {e}")))
}

/// Riot Client needs arguments, which Explorer can't pass directly: hand it a
/// temporary shortcut that carries them.
fn launch_riot(product: &str, game_exe: &Path) -> AppResult<()> {
    let client = [PathBuf::from(r"C:\Riot Games\Riot Client\RiotClientServices.exe")]
        .into_iter()
        .chain(game_exe.ancestors().map(|a| a.join(r"Riot Client\RiotClientServices.exe")))
        .find(|p| p.is_file())
        .ok_or_else(|| AppError::Unsupported("Riot Client not found".into()))?;
    let lnk = std::env::temp_dir().join(format!("FreshOptimizer-{product}.lnk"));
    util::powershell(&format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut({});$s.TargetPath={};$s.Arguments={};$s.Save()",
        util::ps_quote(&lnk.display().to_string()),
        util::ps_quote(&client.display().to_string()),
        util::ps_quote(&format!("--launch-product={product} --launch-patchline=live"))
    ))?;
    open_unelevated(&lnk.display().to_string())
}

pub fn launch(id: &str) -> AppResult<String> {
    let inst = installs().into_iter().find(|i| i.id == id).ok_or_else(|| AppError::Unsupported("Game not installed".into()))?;
    match &inst.launch {
        Launch::Steam(app) => {
            open_unelevated(&format!("steam://rungameid/{app}"))?;
            Ok("Starting through Steam".into())
        }
        Launch::Epic(launch_id) => {
            open_unelevated(&format!("com.epicgames.launcher://apps/{launch_id}?action=launch&silent=true"))?;
            Ok("Starting through Epic Games".into())
        }
        Launch::Riot(product) => {
            launch_riot(product, &inst.exe)?;
            Ok("Starting through Riot Client".into())
        }
        Launch::BattleNet(code) => {
            open_unelevated(&format!("battlenet://{code}"))?;
            Ok("Starting through Battle.net".into())
        }
        Launch::Exe => {
            open_unelevated(&inst.exe.display().to_string())?;
            Ok("Starting".into())
        }
    }
}

pub fn open_folder(id: &str) -> AppResult<()> {
    let inst = installs().into_iter().find(|i| i.id == id).ok_or_else(|| AppError::Unsupported("Game not installed".into()))?;
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{}", inst.exe.display()))
        .spawn()
        .map(|_| ())
        .map_err(|e| AppError::Command(format!("explorer: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_libraryfolders() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        assert_eq!(parse_vdf_paths(vdf), vec![r"C:\Program Files (x86)\Steam", r"D:\SteamLibrary"]);
    }

    #[test]
    fn store_names_match_loosely() {
        assert!(names_match("Marvel's Spider-Man 2", "Marvel's Spider-Man 2"));
        assert!(names_match("Ghost of Tsushima DIRECTOR'S CUT", "Ghost of Tsushima"));
        assert!(!names_match("Fortnite", "Rocket League"));
    }
}
