//! FreshOptimizer Setup: a fully custom installer / uninstaller.
//!
//! The release app binary is deflate-compressed into this executable at build
//! time. Installing extracts it to Program Files, copies this executable next to
//! it as the uninstaller, creates shortcuts and registers with Windows "Apps".
//! Running that copy with `--uninstall` (or named "Uninstall …") shows the
//! uninstall flow instead.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use winreg::enums::*;
use winreg::RegKey;

const PAYLOAD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/payload.bin"));
const PAYLOAD_SIZE: u64 = parse_u64(env!("FO_PAYLOAD_SIZE"));
const VERSION: &str = env!("FO_APP_VERSION");

const APP_EXE: &str = "freshoptimizer.exe";
const UNINSTALLER_EXE: &str = "Uninstall FreshOptimizer.exe";
const PRODUCT: &str = "FreshOptimizer";
const UNINSTALL_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\FreshOptimizer";
const APP_IDENTIFIER: &str = "com.freshoptimizer.app";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const DETACHED_PROCESS: u32 = 0x0000_0008;

const fn parse_u64(s: &str) -> u64 {
    let b = s.as_bytes();
    let mut i = 0;
    let mut n = 0u64;
    while i < b.len() {
        n = n * 10 + (b[i] - b'0') as u64;
        i += 1;
    }
    n
}

// ---------------------------------------------------------------- info

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    mode: &'static str,
    version: &'static str,
    default_dir: String,
    installed_version: Option<String>,
    install_size_mb: f64,
}

fn program_files() -> PathBuf {
    std::env::var_os("ProgramW6432")
        .or_else(|| std::env::var_os("ProgramFiles"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"))
}

fn hklm_uninstall() -> Option<RegKey> {
    RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(UNINSTALL_KEY).ok()
}

fn installed_dir() -> Option<PathBuf> {
    hklm_uninstall()
        .and_then(|k| k.get_value::<String, _>("InstallLocation").ok())
        .map(|s| PathBuf::from(s.trim_matches('"')))
}

fn is_uninstall_mode() -> bool {
    std::env::args().any(|a| a == "--uninstall")
        || std::env::current_exe()
            .ok()
            .and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()))
            .is_some_and(|n| n.starts_with("uninstall"))
}

#[tauri::command]
fn get_info() -> Info {
    let uninstall = is_uninstall_mode();
    let default_dir = if uninstall {
        std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf))
    } else {
        installed_dir()
    }
    .unwrap_or_else(|| program_files().join(PRODUCT));
    Info {
        mode: if uninstall { "uninstall" } else { "install" },
        version: VERSION,
        default_dir: default_dir.display().to_string(),
        installed_version: hklm_uninstall().and_then(|k| k.get_value::<String, _>("DisplayVersion").ok()).or_else(legacy_version),
        install_size_mb: (PAYLOAD_SIZE as f64 / 1_048_576.0 * 10.0).round() / 10.0,
    }
}

// ---------------------------------------------------------------- helpers

fn progress(app: &AppHandle, pct: u32, label: &str) {
    let _ = app.emit("progress", serde_json::json!({ "pct": pct, "label": label }));
}

fn app_running() -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("IMAGENAME eq {APP_EXE}"), "/NH"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).to_lowercase().contains(APP_EXE))
        .unwrap_or(false)
}

#[tauri::command]
fn close_app() -> Result<(), String> {
    Command::new("taskkill")
        .args(["/IM", APP_EXE, "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| e.to_string())?;
    std::thread::sleep(Duration::from_millis(600));
    Ok(())
}

fn powershell(script: &str) -> Result<(), String> {
    let st = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .status()
        .map_err(|e| e.to_string())?;
    if st.success() {
        Ok(())
    } else {
        Err("PowerShell failed".into())
    }
}

fn q(s: &Path) -> String {
    format!("'{}'", s.display().to_string().replace('\'', "''"))
}

fn start_menu_link() -> PathBuf {
    PathBuf::from(std::env::var("ProgramData").unwrap_or_else(|_| r"C:\ProgramData".into()))
        .join(r"Microsoft\Windows\Start Menu\Programs")
        .join(format!("{PRODUCT}.lnk"))
}

fn desktop_link() -> PathBuf {
    PathBuf::from(std::env::var("PUBLIC").unwrap_or_else(|_| r"C:\Users\Public".into()))
        .join("Desktop")
        .join(format!("{PRODUCT}.lnk"))
}

fn create_shortcut(link: &Path, target: &Path) -> Result<(), String> {
    let dir = target.parent().unwrap_or(Path::new("."));
    powershell(&format!(
        "$s=(New-Object -ComObject WScript.Shell).CreateShortcut({});$s.TargetPath={};$s.WorkingDirectory={};$s.IconLocation={};$s.Description='Smoother games. Lower ping.';$s.Save()",
        q(link),
        q(target),
        q(dir),
        q(&PathBuf::from(format!("{},0", target.display())))
    ))
}

/// The 0.1.0 release used Tauri's per-user NSIS installer. Remove it silently.
fn legacy_key() -> Option<RegKey> {
    RegKey::predef(HKEY_CURRENT_USER).open_subkey(UNINSTALL_KEY).ok()
}

fn legacy_version() -> Option<String> {
    legacy_key().and_then(|k| k.get_value::<String, _>("DisplayVersion").ok())
}

fn remove_legacy() {
    let Some(key) = legacy_key() else { return };
    let loc: Option<String> = key.get_value("InstallLocation").ok();
    let uninst: Option<String> = key.get_value("UninstallString").ok();
    if let (Some(loc), Some(uninst)) = (loc, uninst) {
        let loc = loc.trim_matches('"').to_string();
        let exe = uninst.trim_matches('"').to_string();
        // `_?=` keeps the NSIS uninstaller in place so we can wait for it.
        let _ = Command::new(&exe).arg("/S").arg(format!("_?={loc}")).creation_flags(CREATE_NO_WINDOW).status();
        let _ = fs::remove_file(&exe);
        let _ = fs::remove_dir(&loc);
    }
    let _ = RegKey::predef(HKEY_CURRENT_USER).delete_subkey_all(UNINSTALL_KEY);
}

// ---------------------------------------------------------------- install

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallOptions {
    dir: String,
    desktop: bool,
    start_menu: bool,
}

/// Keeps the folder dedicated to us: picking "D:\Games" installs to "D:\Games\FreshOptimizer".
fn normalize_dir(dir: &str) -> PathBuf {
    let p = PathBuf::from(dir.trim());
    if p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case(PRODUCT)) {
        p
    } else {
        p.join(PRODUCT)
    }
}

#[tauri::command]
async fn install(app: AppHandle, opts: InstallOptions) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || do_install(&app, opts))
        .await
        .map_err(|e| e.to_string())?
}

fn do_install(app: &AppHandle, opts: InstallOptions) -> Result<String, String> {
    if app_running() {
        return Err("app_running".into());
    }
    let dir = normalize_dir(&opts.dir);
    progress(app, 3, "Getting ready");

    if legacy_key().is_some() {
        progress(app, 6, "Removing the previous version");
        remove_legacy();
    }

    fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create {}: {e}", dir.display()))?;
    progress(app, 10, "Unpacking FreshOptimizer");

    let exe = dir.join(APP_EXE);
    let tmp = dir.join(format!("{APP_EXE}.partial"));
    {
        let mut dec = flate2::read::DeflateDecoder::new(PAYLOAD);
        let mut out = fs::File::create(&tmp).map_err(|e| format!("Couldn't write to {}: {e}", dir.display()))?;
        let mut buf = vec![0u8; 128 * 1024];
        let mut written = 0u64;
        loop {
            let n = dec.read(&mut buf).map_err(|e| format!("Installer is damaged: {e}"))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            written += n as u64;
            let pct = 10 + (written * 70 / PAYLOAD_SIZE.max(1)) as u32;
            progress(app, pct.min(80), "Unpacking FreshOptimizer");
            // Pace the bar so each step is readable instead of a flash.
            std::thread::sleep(Duration::from_millis(14));
        }
        out.sync_all().map_err(|e| e.to_string())?;
    }
    if exe.exists() {
        fs::remove_file(&exe).map_err(|_| "app_running".to_string())?;
    }
    fs::rename(&tmp, &exe).map_err(|e| e.to_string())?;

    progress(app, 84, "Adding the uninstaller");
    let me = std::env::current_exe().map_err(|e| e.to_string())?;
    let uninstaller = dir.join(UNINSTALLER_EXE);
    if me != uninstaller {
        fs::copy(&me, &uninstaller).map_err(|e| e.to_string())?;
    }

    progress(app, 90, "Creating shortcuts");
    if opts.start_menu {
        create_shortcut(&start_menu_link(), &exe)?;
    } else {
        let _ = fs::remove_file(start_menu_link());
    }
    if opts.desktop {
        create_shortcut(&desktop_link(), &exe)?;
    } else {
        let _ = fs::remove_file(desktop_link());
    }

    progress(app, 96, "Registering with Windows");
    let (key, _) = RegKey::predef(HKEY_LOCAL_MACHINE).create_subkey(UNINSTALL_KEY).map_err(|e| e.to_string())?;
    let set = |n: &str, v: &str| key.set_value(n, &v.to_string()).map_err(|e| e.to_string());
    set("DisplayName", PRODUCT)?;
    set("DisplayVersion", VERSION)?;
    set("Publisher", PRODUCT)?;
    set("DisplayIcon", &format!("{},0", exe.display()))?;
    set("InstallLocation", &dir.display().to_string())?;
    set("UninstallString", &format!("\"{}\" --uninstall", uninstaller.display()))?;
    set("URLInfoAbout", "https://github.com/mohibk0004-del/fresh-optimizer")?;
    let _ = key.set_value("EstimatedSize", &((PAYLOAD_SIZE / 1024) as u32 + 2048));
    let _ = key.set_value("NoModify", &1u32);
    let _ = key.set_value("NoRepair", &1u32);

    std::thread::sleep(Duration::from_millis(250));
    progress(app, 100, "Done");
    Ok(dir.display().to_string())
}

#[tauri::command]
fn launch_app(dir: String) -> Result<(), String> {
    Command::new(PathBuf::from(dir).join(APP_EXE))
        .creation_flags(DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- uninstall

#[tauri::command]
async fn uninstall(app: AppHandle, restore: bool) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || do_uninstall(&app, restore))
        .await
        .map_err(|e| e.to_string())?
}

/// Returns whether every Windows setting was restored.
fn do_uninstall(app: &AppHandle, restore: bool) -> Result<bool, String> {
    if app_running() {
        return Err("app_running".into());
    }
    let dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .or_else(installed_dir)
        .ok_or("Couldn't find the install folder")?;
    let exe = dir.join(APP_EXE);

    let mut restored = true;
    if restore && exe.exists() {
        progress(app, 15, "Restoring your original Windows settings");
        restored = Command::new(&exe)
            .arg("--rollback")
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
    }

    // "Launch at startup" scheduled task created by the app's Settings page.
    let _ = Command::new("schtasks").args(["/Delete", "/TN", PRODUCT, "/F"]).creation_flags(CREATE_NO_WINDOW).status();

    progress(app, 55, "Removing shortcuts");
    let _ = fs::remove_file(start_menu_link());
    let _ = fs::remove_file(desktop_link());
    std::thread::sleep(Duration::from_millis(250));

    progress(app, 70, "Removing FreshOptimizer");
    let _ = fs::remove_file(&exe);
    let _ = fs::remove_file(dir.join(format!("{APP_EXE}.partial")));
    // WebView cache; settings in %APPDATA% are only removed once nothing is left to restore.
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let _ = fs::remove_dir_all(PathBuf::from(local).join(APP_IDENTIFIER));
    }
    if restored {
        if let Some(roaming) = std::env::var_os("APPDATA") {
            let _ = fs::remove_dir_all(PathBuf::from(roaming).join(APP_IDENTIFIER));
        }
        // Restore point (0.4.0+ keeps it in a locked ProgramData folder).
        if let Some(pd) = std::env::var_os("ProgramData") {
            let _ = fs::remove_dir_all(PathBuf::from(pd).join(PRODUCT));
        }
    }
    std::thread::sleep(Duration::from_millis(250));

    progress(app, 90, "Unregistering from Windows");
    let _ = RegKey::predef(HKEY_LOCAL_MACHINE).delete_subkey_all(UNINSTALL_KEY);
    std::thread::sleep(Duration::from_millis(250));

    progress(app, 100, "Done");
    Ok(restored)
}

/// The uninstaller can't delete itself while running: hand that to a detached
/// shell that waits for us to exit, then removes our file and the (now empty) folder.
#[tauri::command]
fn finish_uninstall(app: AppHandle) {
    if let Ok(me) = std::env::current_exe() {
        if let Some(dir) = me.parent() {
            let cmd = format!(
                "ping -n 3 127.0.0.1 >nul & del /f /q \"{}\" & rmdir \"{}\"",
                me.display(),
                dir.display()
            );
            let _ = Command::new("cmd").args(["/C", &cmd]).creation_flags(CREATE_NO_WINDOW | DETACHED_PROCESS).spawn();
        }
    }
    app.exit(0);
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![get_info, install, launch_app, close_app, uninstall, finish_uninstall])
        .run(tauri::generate_context!())
        .expect("failed to start FreshOptimizer Setup");
}
