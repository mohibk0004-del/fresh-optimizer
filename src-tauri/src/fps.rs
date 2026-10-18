//! Real FPS and frame-time measurement with Intel PresentMon (MIT licence).
//!
//! PresentMon reads Windows' own graphics event tracing (ETW): it never
//! touches the game process, so it's as safe with anti-cheat as Task Manager.
//! It's downloaded only when the user asks, from a pinned release whose
//! SHA-256 is checked, into the admin-only ProgramData folder.
//!
//! While "Full power for games" is watching, each supported game gets one
//! capture that ends when the game exits. The CSV is summarised (average FPS,
//! 1 % / 0.1 % lows, stutters) and deleted; only the summary is kept.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::util;

const VERSION: &str = "2.6.0";
const URL: &str = "https://github.com/GameTechDev/PresentMon/releases/download/v2.6.0/PresentMon-2.6.0-x64.exe";
const SHA256: &str = "B2A706BC6AD475749E3B7E3409263AA1E6906D45BDCF993F6DBC0F660188F1AF";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_SESSIONS: usize = 200;
/// Shorter sessions (menus, crashes, quick restarts) aren't worth comparing.
const MIN_SECONDS: f64 = 30.0;

static ENABLED: AtomicBool = AtomicBool::new(true);
static CAPTURES: Mutex<Option<HashMap<u32, Capture>>> = Mutex::new(None);
static SESSIONS_LOCK: Mutex<()> = Mutex::new(());

struct Capture {
    child: Child,
    csv: PathBuf,
    game_id: String,
    game: String,
    started: u64,
    boosted: bool,
    since: Instant,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub game_id: String,
    pub game: String,
    /// Unix seconds.
    pub started: u64,
    pub seconds: f64,
    pub frames: u64,
    pub avg_fps: f64,
    /// Average FPS of the slowest 1 % / 0.1 % of frames.
    pub low1_fps: f64,
    pub low01_fps: f64,
    pub median_ms: f64,
    /// Frames that took over 2.5x the median (and over 20 ms): visible hitches.
    pub stutters: u64,
    /// Boost tweaks were applied during this session.
    pub boosted: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FpsStatus {
    pub installed: bool,
    pub version: &'static str,
    pub enabled: bool,
    /// Games being measured right now.
    pub capturing: Vec<String>,
    pub sessions: Vec<Session>,
}

fn dir() -> PathBuf {
    crate::restore::secure_dir()
}

fn exe() -> PathBuf {
    dir().join("tools").join(format!("PresentMon-{VERSION}.exe"))
}

fn sessions_path() -> PathBuf {
    dir().join("fps-sessions.json")
}

pub fn installed() -> bool {
    exe().is_file()
}

pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::SeqCst);
}

pub fn sessions() -> Vec<Session> {
    std::fs::read(sessions_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn status() -> FpsStatus {
    let capturing = CAPTURES.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|m| m.values().map(|c| c.game.clone()).collect()).unwrap_or_default();
    FpsStatus { installed: installed(), version: VERSION, enabled: ENABLED.load(Ordering::SeqCst), capturing, sessions: sessions() }
}

fn sha256_of(path: &std::path::Path) -> AppResult<String> {
    let out = util::powershell(&format!("(Get-FileHash -Algorithm SHA256 -LiteralPath {}).Hash", util::ps_quote(&path.display().to_string())))?;
    Ok(out.trim().to_uppercase())
}

/// Downloads PresentMon and keeps it only if it's byte-for-byte the release we expect.
pub fn install() -> AppResult<()> {
    let tmp = std::env::temp_dir().join(format!("fo-presentmon-{}.exe", std::process::id()));
    let script = format!(
        "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;\
         Invoke-WebRequest -UseBasicParsing -TimeoutSec 120 -Headers @{{'User-Agent'='FreshOptimizer'}} -Uri {} -OutFile {}",
        util::ps_quote(URL),
        util::ps_quote(&tmp.display().to_string())
    );
    util::powershell(&script).map_err(|_| AppError::Other("Download failed. Check your connection and try again.".into()))?;
    let hash = sha256_of(&tmp);
    if hash.as_deref().ok() != Some(SHA256) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::Other("The download didn't match Intel's official PresentMon release, so it was deleted.".into()));
    }
    let target = exe();
    std::fs::create_dir_all(target.parent().unwrap_or(&dir())).map_err(|e| AppError::AccessDenied(format!("tools folder: {e}")))?;
    let r = std::fs::copy(&tmp, &target);
    let _ = std::fs::remove_file(&tmp);
    r.map(|_| ()).map_err(|e| AppError::AccessDenied(format!("Run FreshOptimizer as administrator to set this up ({e})")))
}

pub fn uninstall() -> AppResult<()> {
    let _ = std::fs::remove_dir_all(dir().join("tools"));
    Ok(())
}

pub fn clear_sessions() -> AppResult<()> {
    let _g = SESSIONS_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _ = std::fs::remove_file(sessions_path());
    Ok(())
}

/// Starts measuring `pid` until it exits. No-op if switched off or not set up.
pub fn start(pid: u32, game_id: &str, game: &str, boosted: bool) {
    if !ENABLED.load(Ordering::SeqCst) || !installed() {
        return;
    }
    let mut caps = CAPTURES.lock().unwrap_or_else(|p| p.into_inner());
    let caps = caps.get_or_insert_with(HashMap::new);
    if caps.contains_key(&pid) {
        return;
    }
    let csv = dir().join(format!("capture-{pid}.csv"));
    let child = Command::new(exe())
        .args([
            "--process_id",
            &pid.to_string(),
            "--output_file",
            &csv.display().to_string(),
            "--terminate_on_proc_exit",
            "--stop_existing_session",
            "--session_name",
            &format!("FreshOptimizer_{pid}"),
            "--no_console_stats",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    if let Ok(child) = child {
        caps.insert(pid, Capture { child, csv, game_id: game_id.into(), game: game.into(), started: util::now_unix(), boosted, since: Instant::now() });
    }
}

/// Called when the game exits: waits for PresentMon to flush, then keeps the summary.
pub fn finish(pid: u32) -> Option<Session> {
    let cap = CAPTURES.lock().unwrap_or_else(|p| p.into_inner()).as_mut()?.remove(&pid)?;
    let Capture { mut child, csv, game_id, game, started, boosted, since } = cap;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            break;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let _ = child.kill();
    let _ = child.wait();
    let text = std::fs::read_to_string(&csv).unwrap_or_default();
    let _ = std::fs::remove_file(&csv);
    let frames = frame_times(&text);
    let s = summarize(&frames, game_id, game, started, boosted)?;
    if s.seconds < MIN_SECONDS || since.elapsed().as_secs_f64() < MIN_SECONDS {
        return None;
    }
    let _g = SESSIONS_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut all = sessions();
    all.push(s.clone());
    if all.len() > MAX_SESSIONS {
        let drop = all.len() - MAX_SESSIONS;
        all.drain(..drop);
    }
    let _ = std::fs::write(sessions_path(), serde_json::to_vec(&all).unwrap_or_default());
    Some(s)
}

/// Stops every capture (app closing / watcher off) and keeps what was measured.
pub fn finish_all() {
    let pids: Vec<u32> = CAPTURES.lock().unwrap_or_else(|p| p.into_inner()).as_ref().map(|m| m.keys().copied().collect()).unwrap_or_default();
    for pid in pids {
        // PresentMon only exits with the game; stop the trace so the CSV is flushed.
        let _ = util::run_hidden("logman", &["stop", &format!("FreshOptimizer_{pid}"), "-ets"]);
        finish(pid);
    }
}

/// Frame times (ms) of the busiest swap chain in a PresentMon CSV.
pub fn frame_times(csv: &str) -> Vec<f64> {
    let mut lines = csv.lines();
    let Some(header) = lines.next() else { return Vec::new() };
    let cols: Vec<&str> = header.split(',').map(|c| c.trim()).collect();
    let Some(ft) = cols.iter().position(|c| c.eq_ignore_ascii_case("MsBetweenPresents")) else { return Vec::new() };
    let sc = cols.iter().position(|c| c.eq_ignore_ascii_case("SwapChainAddress"));
    let mut by_chain: HashMap<String, Vec<f64>> = HashMap::new();
    for line in lines {
        let f: Vec<&str> = line.split(',').collect();
        let Some(v) = f.get(ft).and_then(|v| v.trim().parse::<f64>().ok()) else { continue };
        if !(v > 0.0 && v < 5000.0) {
            continue;
        }
        let key = sc.and_then(|i| f.get(i)).map(|s| s.to_string()).unwrap_or_default();
        by_chain.entry(key).or_default().push(v);
    }
    by_chain.into_values().max_by_key(|v| v.len()).unwrap_or_default()
}

pub fn summarize(ms: &[f64], game_id: String, game: String, started: u64, boosted: bool) -> Option<Session> {
    if ms.len() < 100 {
        return None;
    }
    let total: f64 = ms.iter().sum();
    let mut sorted = ms.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let median = sorted[sorted.len() / 2];
    let low = |frac: f64| {
        let n = ((sorted.len() as f64 * frac).ceil() as usize).max(1);
        let worst = &sorted[sorted.len() - n..];
        1000.0 / (worst.iter().sum::<f64>() / n as f64)
    };
    let stutters = ms.iter().filter(|&&v| v > median * 2.5 && v > 20.0).count() as u64;
    let r1 = |v: f64| (v * 10.0).round() / 10.0;
    Some(Session {
        game_id,
        game,
        started,
        seconds: r1(total / 1000.0),
        frames: ms.len() as u64,
        avg_fps: r1(ms.len() as f64 / (total / 1000.0)),
        low1_fps: r1(low(0.01)),
        low01_fps: r1(low(0.001)),
        median_ms: (median * 100.0).round() / 100.0,
        stutters,
        boosted,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarises_frame_times() {
        let mut csv = String::from("Application,ProcessID,SwapChainAddress,MsBetweenPresents\n");
        for i in 0..1000 {
            let ms = if i % 100 == 0 { 50.0 } else { 10.0 };
            csv.push_str(&format!("game.exe,1,0xA,{ms}\n"));
        }
        csv.push_str("game.exe,1,0xB,16.6\n");
        let ft = frame_times(&csv);
        assert_eq!(ft.len(), 1000);
        let s = summarize(&ft, "x".into(), "X".into(), 0, false).unwrap();
        assert_eq!(s.stutters, 10);
        assert!((s.avg_fps - 1000.0 / 10.4).abs() < 0.2, "{}", s.avg_fps);
        assert!((s.low1_fps - 20.0).abs() < 0.1, "{}", s.low1_fps);
    }
}
