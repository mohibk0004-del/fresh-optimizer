//! Competitive game discovery (install paths + running processes) and the
//! process priority / affinity enforcer.
//!
//! Anti-cheat safety: handles are opened with PROCESS_SET_INFORMATION |
//! PROCESS_QUERY_LIMITED_INFORMATION only. No VM read/write, no threads, no DLLs.
//! If an anti-cheat strips even that, the call fails and we report it cleanly;
//! the persistent IFEO `CpuPriorityClass` tweak still applies High priority at launch.

use std::path::PathBuf;

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

use crate::registry::{self, Hive};
use crate::util::wide_to_string;

pub struct GameDef {
    pub id: &'static str,
    pub name: &'static str,
    /// Actual game binaries (not launchers) that receive priority/affinity.
    pub processes: &'static [&'static str],
}

pub const GAMES: &[GameDef] = &[
    GameDef { id: "valorant", name: "VALORANT", processes: &["VALORANT-Win64-Shipping.exe"] },
    GameDef { id: "cs2", name: "Counter-Strike 2", processes: &["cs2.exe"] },
    GameDef { id: "apex", name: "Apex Legends", processes: &["r5apex.exe", "r5apex_dx12.exe"] },
    GameDef { id: "overwatch", name: "Overwatch 2", processes: &["Overwatch.exe"] },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInfo {
    pub id: String,
    pub name: String,
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

pub fn game_for_exe(exe: &str) -> Option<&'static GameDef> {
    GAMES.iter().find(|g| g.processes.iter().any(|p| p.eq_ignore_ascii_case(exe)))
}

// ---------- install discovery ----------

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
    vdf.lines()
        .filter_map(|line| {
            let quoted: Vec<&str> = line.split('"').collect();
            // ["\t\t", "path", "\t\t", "D:\\SteamLibrary", ""]
            if quoted.len() >= 4 && quoted[1].eq_ignore_ascii_case("path") {
                Some(quoted[3].replace("\\\\", "\\"))
            } else {
                None
            }
        })
        .collect()
}

fn riot_install_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    // RiotClientInstalls.json maps product -> client path; VALORANT lives beside it.
    if let Ok(json) = std::fs::read_to_string(r"C:\ProgramData\Riot Games\RiotClientInstalls.json") {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
            if let Some(map) = v.get("associated_client").and_then(|m| m.as_object()) {
                for key in map.keys() {
                    let p = PathBuf::from(key.replace('/', "\\"));
                    if p.to_string_lossy().to_ascii_lowercase().contains("valorant") {
                        roots.push(p);
                    }
                }
            }
        }
    }
    for drive in ["C", "D", "E", "F"] {
        roots.push(PathBuf::from(format!(r"{drive}:\Riot Games\VALORANT\live")));
    }
    roots
}

fn existing(paths: impl IntoIterator<Item = PathBuf>) -> Vec<String> {
    let mut v: Vec<String> = paths.into_iter().filter(|p| p.is_file()).map(|p| p.display().to_string()).collect();
    v.sort();
    v.dedup_by(|a, b| a.eq_ignore_ascii_case(b));
    v
}

fn program_files() -> Vec<PathBuf> {
    ["ProgramFiles", "ProgramFiles(x86)"]
        .iter()
        .filter_map(|k| std::env::var_os(k).map(PathBuf::from))
        .collect()
}

fn install_paths(id: &str, steam: &[PathBuf]) -> Vec<String> {
    let common = |sub: &str| -> Vec<PathBuf> { steam.iter().map(|l| l.join("steamapps").join("common").join(sub)).collect() };
    match id {
        "valorant" => existing(
            riot_install_roots()
                .into_iter()
                .map(|r| r.join(r"ShooterGame\Binaries\Win64\VALORANT-Win64-Shipping.exe")),
        ),
        "cs2" => existing(common(r"Counter-Strike Global Offensive\game\bin\win64\cs2.exe")),
        "apex" => {
            let mut c: Vec<PathBuf> = common("Apex Legends").into_iter().flat_map(|d| [d.join("r5apex.exe"), d.join("r5apex_dx12.exe")]).collect();
            for pf in program_files() {
                let d = pf.join(r"EA Games\Apex Legends");
                c.push(d.join("r5apex.exe"));
                c.push(d.join("r5apex_dx12.exe"));
            }
            existing(c)
        }
        "overwatch" => {
            let mut c: Vec<PathBuf> = common(r"Overwatch\_retail_\Overwatch.exe");
            c.extend(program_files().into_iter().map(|pf| pf.join(r"Overwatch\_retail_\Overwatch.exe")));
            existing(c)
        }
        _ => Vec::new(),
    }
}

pub fn discover() -> Vec<GameInfo> {
    let steam = steam_libraries();
    let procs = list_processes();
    GAMES
        .iter()
        .map(|g| {
            let exe_paths = install_paths(g.id, &steam);
            let running = procs.iter().find(|p| g.processes.iter().any(|n| n.eq_ignore_ascii_case(&p.exe)));
            GameInfo {
                id: g.id.into(),
                name: g.name.into(),
                installed: !exe_paths.is_empty() || running.is_some(),
                exe_paths,
                running: running.is_some(),
                pid: running.map(|p| p.pid),
                priority: running.and_then(|p| priority_label(p.pid)),
            }
        })
        .collect()
}

pub fn installed_exe_paths() -> Vec<String> {
    discover().into_iter().flat_map(|g| g.exe_paths).collect()
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

/// Sets HIGH_PRIORITY_CLASS and, on hybrid CPUs, restricts affinity to P-cores.
pub fn enforce(pid: u32, exe: &str, p_core_mask: Option<u64>) -> EnforceResult {
    let mut r = EnforceResult { pid, exe: exe.into(), priority_set: false, affinity_set: None, note: None };
    // SAFETY: minimal-rights handle, checked and closed.
    unsafe {
        let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            r.note = Some("Process is protected (anti-cheat) - using launch-time IFEO priority instead".into());
            return r;
        }
        r.priority_set = SetPriorityClass(h, HIGH_PRIORITY_CLASS) != 0;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_libraryfolders() {
        let vdf = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"C:\\\\Program Files (x86)\\\\Steam\"\n\t}\n\t\"1\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        assert_eq!(parse_vdf_paths(vdf), vec![r"C:\Program Files (x86)\Steam", r"D:\SteamLibrary"]);
    }
}
