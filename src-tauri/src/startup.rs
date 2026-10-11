//! Startup apps manager. Uses the same "StartupApproved" switches as Task
//! Manager's Startup tab, so nothing is deleted: disabling only flips a flag,
//! and every flip goes through the restore point.

use std::path::PathBuf;

use serde::Serialize;
use winreg::enums::*;
use winreg::RegKey;

use crate::error::{AppError, AppResult};
use crate::registry::{self, Hive};
use crate::restore::RestoreStore;

const APPROVED: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved";

#[derive(Debug, Clone, Copy)]
enum Source {
    UserRun,
    MachineRun,
    MachineRun32,
    UserFolder,
    CommonFolder,
}

impl Source {
    const ALL: [Source; 5] = [Source::UserRun, Source::MachineRun, Source::MachineRun32, Source::UserFolder, Source::CommonFolder];

    fn id(self) -> &'static str {
        match self {
            Source::UserRun => "userRun",
            Source::MachineRun => "machineRun",
            Source::MachineRun32 => "machineRun32",
            Source::UserFolder => "userFolder",
            Source::CommonFolder => "commonFolder",
        }
    }

    fn from_id(id: &str) -> Option<Source> {
        Source::ALL.into_iter().find(|s| s.id() == id)
    }

    /// Where Task Manager stores the enabled/disabled flag for this source.
    fn approved(self) -> (Hive, String) {
        match self {
            Source::UserRun => (Hive::CurrentUser, format!(r"{APPROVED}\Run")),
            Source::MachineRun => (Hive::LocalMachine, format!(r"{APPROVED}\Run")),
            Source::MachineRun32 => (Hive::LocalMachine, format!(r"{APPROVED}\Run32")),
            Source::UserFolder => (Hive::CurrentUser, format!(r"{APPROVED}\StartupFolder")),
            Source::CommonFolder => (Hive::LocalMachine, format!(r"{APPROVED}\StartupFolder")),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    /// Registry value name or shortcut file name: the key Task Manager uses.
    pub name: String,
    pub display: String,
    pub command: String,
    pub source: &'static str,
    pub all_users: bool,
    pub enabled: bool,
}

fn run_entries(root: &RegKey, path: &str) -> Vec<(String, String)> {
    root.open_subkey_with_flags(path, KEY_READ)
        .map(|k| k.enum_values().filter_map(|r| r.ok()).map(|(n, v)| (n, v.to_string())).collect())
        .unwrap_or_default()
}

fn folder_entries(dir: Option<PathBuf>) -> Vec<(String, String)> {
    let Some(dir) = dir else { return Vec::new() };
    std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .filter(|n| !n.eq_ignore_ascii_case("desktop.ini"))
                .map(|n| (n.clone(), n))
                .collect()
        })
        .unwrap_or_default()
}

fn user_startup_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs\Startup"))
}

fn common_startup_dir() -> Option<PathBuf> {
    std::env::var_os("ProgramData").map(|a| PathBuf::from(a).join(r"Microsoft\Windows\Start Menu\Programs\StartUp"))
}

fn is_enabled(source: Source, name: &str) -> bool {
    let (hive, path) = source.approved();
    match registry::read_raw(hive, &path, name) {
        // First byte: even = enabled (02, 06), odd = disabled (03, 07).
        Some(v) => v.data.first().map(|b| b & 1 == 0).unwrap_or(true),
        None => true,
    }
}

/// Program path only, without quotes or launch arguments.
fn clean(s: &str) -> String {
    let s = s.trim();
    if let Some(rest) = s.strip_prefix('"') {
        return rest.split('"').next().unwrap_or(rest).to_string();
    }
    match s.to_ascii_lowercase().find(".exe") {
        Some(i) => s[..i + 4].to_string(),
        None => s.to_string(),
    }
}

fn display_name(name: &str) -> String {
    let base = name.strip_suffix(".lnk").or_else(|| name.strip_suffix(".url")).unwrap_or(name);
    base.to_string()
}

pub fn list() -> Vec<StartupItem> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let run = r"Software\Microsoft\Windows\CurrentVersion\Run";
    let mut out = Vec::new();
    let sources: [(Source, Vec<(String, String)>); 5] = [
        (Source::UserRun, run_entries(&hkcu, run)),
        (Source::MachineRun, run_entries(&hklm, run)),
        (Source::MachineRun32, run_entries(&hklm, r"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run")),
        (Source::UserFolder, folder_entries(user_startup_dir())),
        (Source::CommonFolder, folder_entries(common_startup_dir())),
    ];
    for (source, entries) in sources {
        for (name, command) in entries {
            if name.is_empty() {
                continue;
            }
            out.push(StartupItem {
                display: display_name(&name),
                enabled: is_enabled(source, &name),
                command: clean(&command),
                all_users: matches!(source, Source::MachineRun | Source::MachineRun32 | Source::CommonFolder),
                source: source.id(),
                name,
            });
        }
    }
    out.sort_by_key(|i| i.display.to_lowercase());
    out
}

pub fn set_enabled(store: &RestoreStore, source: &str, name: &str, enabled: bool) -> AppResult<()> {
    let src = Source::from_id(source).ok_or_else(|| AppError::Other(format!("unknown startup source '{source}'")))?;
    let (hive, path) = src.approved();
    // 12-byte record: flag + 8-byte FILETIME (zero is fine) + padding.
    let mut data = vec![0u8; 12];
    data[0] = if enabled { 0x02 } else { 0x03 };
    registry::set_binary_tracked(store, "startup", hive, &path, name, &data)?;
    store.mark_applied("startup");
    Ok(())
}
