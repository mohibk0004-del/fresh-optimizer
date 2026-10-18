//! Extras that only run while a game is being played:
//!
//! * **Background hogs**: other programs using a lot of CPU or disk. The user
//!   can lower their priority or close them; with "auto-lower" on, hogs get
//!   Below Normal priority automatically. Nothing is ever force-closed, and every
//!   priority we lowered is put back when the game exits.
//! * **Pause Windows Update**: the same "Pause updates" values the Settings app
//!   writes, set to expire in 24 hours (so a crash can't leave updates paused
//!   for long) and restored to what they were when the game exits.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use windows_sys::Win32::Foundation::{CloseHandle, FILETIME};
use windows_sys::Win32::System::Threading::{
    GetPriorityClass, GetProcessIoCounters, GetProcessTimes, OpenProcess, SetPriorityClass, BELOW_NORMAL_PRIORITY_CLASS, IO_COUNTERS,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION,
};

use crate::error::{AppError, AppResult};
use crate::games::RunningProcess;
use crate::registry::{self, Hive, StoredValue};
use crate::util;

pub static PAUSE_UPDATES: AtomicBool = AtomicBool::new(false);
pub static AUTO_LOWER: AtomicBool = AtomicBool::new(false);

/// Share of the whole CPU (all cores) that counts as hogging.
const CPU_HOG_PCT: f64 = 8.0;
const IO_HOG_MBPS: f64 = 25.0;
/// Average over this many samples (2 s each) so a short spike isn't flagged.
const SAMPLES: usize = 3;

/// Windows itself, anti-cheat and audio: never offered for closing or lowering.
const PROTECTED: &[&str] = &[
    "system", "registry", "smss.exe", "csrss.exe", "wininit.exe", "winlogon.exe", "services.exe", "lsass.exe", "svchost.exe", "dwm.exe", "fontdrvhost.exe",
    "audiodg.exe", "msmpeng.exe", "memcompression", "explorer.exe", "vgc.exe", "vgtray.exe", "easyanticheat.exe", "easyanticheat_eos.exe", "beservice.exe",
    "beservice_x64.exe", "faceit.exe", "faceitservice.exe", "steamservice.exe", "freshoptimizer.exe", "presentmon-2.6.0.exe", "searchindexer.exe",
    // More anti-cheats: EA Javelin, nProtect GameGuard, Tencent ACE, ESEA, Ricochet's helpers, XIGNCODE.
    "eaanticheat.gameservice.exe", "eaanticheat.installer.exe", "gamemon.des", "gamemon64.des", "gameguard.des", "sguard64.exe", "sguardsvc64.exe",
    "ace-tray.exe", "esea client.exe", "eseaclient.exe", "randgrid.exe", "xxd-0.xem", "xigncode.exe", "nprotect.exe",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hog {
    pub pid: u32,
    pub exe: String,
    /// Percent of the whole CPU.
    pub cpu_pct: f64,
    pub disk_mbps: f64,
    /// Windows process we won't touch.
    pub protected: bool,
    pub lowered: bool,
}

struct Sample {
    at: Instant,
    cpu_100ns: u64,
    io_bytes: u64,
}

#[derive(Default)]
struct State {
    last: HashMap<u32, Sample>,
    history: HashMap<u32, Vec<(f64, f64)>>,
    /// pid -> priority class before we lowered it.
    lowered: HashMap<u32, u32>,
    reported: HashSet<u32>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn ft(f: FILETIME) -> u64 {
    ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64
}

fn read(pid: u32) -> Option<(u64, u64)> {
    // SAFETY: query-only handle, checked and closed.
    unsafe {
        let h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return None;
        }
        let (mut c, mut e, mut k, mut u) = (std::mem::zeroed(), std::mem::zeroed(), std::mem::zeroed(), std::mem::zeroed());
        let mut io: IO_COUNTERS = std::mem::zeroed();
        let ok = GetProcessTimes(h, &mut c, &mut e, &mut k, &mut u) != 0;
        let io_ok = GetProcessIoCounters(h, &mut io) != 0;
        CloseHandle(h);
        ok.then(|| (ft(k) + ft(u), if io_ok { io.ReadTransferCount + io.WriteTransferCount } else { 0 }))
    }
}

/// One sampling pass. Returns programs that have been heavy for the last few seconds,
/// plus the ones that are newly heavy (for a one-time notification).
pub fn sample(procs: &[RunningProcess], game_pids: &HashSet<u32>, threads: u32) -> (Vec<Hog>, Vec<Hog>) {
    let mut guard = STATE.lock().unwrap_or_else(|p| p.into_inner());
    let st = guard.get_or_insert_with(State::default);
    let now = Instant::now();
    let me = std::process::id();
    let mut alive = HashSet::new();
    let mut hogs = Vec::new();
    for p in procs {
        if p.pid <= 4 || p.pid == me || game_pids.contains(&p.pid) {
            continue;
        }
        alive.insert(p.pid);
        let Some((cpu, io)) = read(p.pid) else { continue };
        let prev = st.last.insert(p.pid, Sample { at: now, cpu_100ns: cpu, io_bytes: io });
        let Some(prev) = prev else { continue };
        let secs = now.duration_since(prev.at).as_secs_f64().max(0.5);
        let cpu_pct = (cpu.saturating_sub(prev.cpu_100ns) as f64 / 1e7) / secs / threads.max(1) as f64 * 100.0;
        let mbps = io.saturating_sub(prev.io_bytes) as f64 / secs / 1e6;
        let h = st.history.entry(p.pid).or_default();
        h.push((cpu_pct, mbps));
        if h.len() > SAMPLES {
            h.remove(0);
        }
        if h.len() < SAMPLES {
            continue;
        }
        let avg_cpu = h.iter().map(|x| x.0).sum::<f64>() / h.len() as f64;
        let avg_io = h.iter().map(|x| x.1).sum::<f64>() / h.len() as f64;
        if avg_cpu >= CPU_HOG_PCT || avg_io >= IO_HOG_MBPS {
            let protected = PROTECTED.iter().any(|n| n.eq_ignore_ascii_case(&p.exe));
            hogs.push(Hog {
                pid: p.pid,
                exe: p.exe.clone(),
                cpu_pct: (avg_cpu * 10.0).round() / 10.0,
                disk_mbps: (avg_io * 10.0).round() / 10.0,
                protected,
                lowered: st.lowered.contains_key(&p.pid),
            });
        }
    }
    st.last.retain(|pid, _| alive.contains(pid));
    st.history.retain(|pid, _| alive.contains(pid));
    st.lowered.retain(|pid, _| alive.contains(pid));
    hogs.sort_by(|a, b| b.cpu_pct.partial_cmp(&a.cpu_pct).unwrap_or(std::cmp::Ordering::Equal));

    if AUTO_LOWER.load(Ordering::SeqCst) {
        for h in hogs.iter_mut().filter(|h| !h.protected && !h.lowered) {
            h.lowered = lower_locked(st, h.pid).is_ok();
        }
    }
    let fresh: Vec<Hog> = hogs.iter().filter(|h| st.reported.insert(h.pid)).cloned().collect();
    (hogs, fresh)
}

fn lower_locked(st: &mut State, pid: u32) -> AppResult<()> {
    // SAFETY: minimal-rights handle, checked and closed.
    unsafe {
        let h = OpenProcess(PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if h.is_null() {
            return Err(AppError::AccessDenied("Windows won't let us change that program.".into()));
        }
        let prior = GetPriorityClass(h);
        let ok = SetPriorityClass(h, BELOW_NORMAL_PRIORITY_CLASS) != 0;
        CloseHandle(h);
        if !ok {
            return Err(AppError::AccessDenied("Windows won't let us change that program.".into()));
        }
        st.lowered.entry(pid).or_insert(prior);
    }
    Ok(())
}

fn check_allowed(pid: u32) -> AppResult<String> {
    let exe = crate::games::list_processes().into_iter().find(|p| p.pid == pid).map(|p| p.exe).ok_or_else(|| AppError::Other("That program already closed.".into()))?;
    if PROTECTED.iter().any(|n| n.eq_ignore_ascii_case(&exe)) {
        return Err(AppError::Unsupported(format!("{exe} is part of Windows or anti-cheat, so we leave it alone.")));
    }
    Ok(exe)
}

pub fn lower(pid: u32) -> AppResult<()> {
    check_allowed(pid)?;
    let mut guard = STATE.lock().unwrap_or_else(|p| p.into_inner());
    lower_locked(guard.get_or_insert_with(State::default), pid)
}

/// Asks the program to close the normal way (like clicking X). It can still
/// ask to save work, or refuse; we never force it.
pub fn close(pid: u32) -> AppResult<()> {
    check_allowed(pid)?;
    util::run_hidden("taskkill", &["/PID", &pid.to_string()]).map(|_| ()).map_err(|_| AppError::Other("It didn't close. It may be waiting for you, or only closes from its own window.".into()))
}

fn restore_priorities() {
    let mut guard = STATE.lock().unwrap_or_else(|p| p.into_inner());
    let Some(st) = guard.as_mut() else { return };
    for (pid, prior) in st.lowered.drain() {
        // SAFETY: minimal-rights handle, checked and closed.
        unsafe {
            let h = OpenProcess(PROCESS_SET_INFORMATION, 0, pid);
            if !h.is_null() {
                SetPriorityClass(h, prior);
                CloseHandle(h);
            }
        }
    }
    st.reported.clear();
    st.history.clear();
}

// ---------- Windows Update pause ----------

const WU_PATH: &str = r"SOFTWARE\Microsoft\WindowsUpdate\UX\Settings";
const WU_STARTS: &[&str] = &["PauseUpdatesStartTime", "PauseFeatureUpdatesStartTime", "PauseQualityUpdatesStartTime"];
const WU_ENDS: &[&str] = &["PauseUpdatesExpiryTime", "PauseFeatureUpdatesEndTime", "PauseQualityUpdatesEndTime"];

#[derive(Serialize, Deserialize)]
struct WuPrior {
    values: Vec<(String, Option<StoredValue>)>,
}

fn wu_state_file() -> std::path::PathBuf {
    crate::restore::secure_dir().join("update-pause.json")
}

/// `YYYY-MM-DDTHH:MM:SSZ` for unix seconds (UTC).
pub fn iso_utc(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn write_sz(name: &str, value: &str) -> AppResult<()> {
    let key = winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE)
        .create_subkey(WU_PATH)
        .map_err(|e| AppError::registry(WU_PATH, e))?
        .0;
    key.set_value(name, &value.to_string()).map_err(|e| AppError::registry(name, e))
}

fn pause_updates() -> AppResult<()> {
    let file = wu_state_file();
    if !file.exists() {
        let values = WU_STARTS.iter().chain(WU_ENDS).map(|n| (n.to_string(), registry::read_raw(Hive::LocalMachine, WU_PATH, n))).collect();
        std::fs::write(&file, serde_json::to_vec(&WuPrior { values }).unwrap_or_default())?;
    }
    let now = util::now_unix();
    let (start, end) = (iso_utc(now), iso_utc(now + 86_400));
    for n in WU_STARTS {
        write_sz(n, &start)?;
    }
    for n in WU_ENDS {
        // Keep a longer pause the user set themselves.
        let theirs = registry::read_string(Hive::LocalMachine, WU_PATH, n);
        if theirs.as_deref().is_none_or(|t| t < end.as_str()) {
            write_sz(n, &end)?;
        }
    }
    Ok(())
}

/// Puts the pause values back exactly as they were. Also called at startup in
/// case the app closed mid-game.
pub fn resume_updates() {
    let file = wu_state_file();
    let Ok(bytes) = std::fs::read(&file) else { return };
    if let Ok(prior) = serde_json::from_slice::<WuPrior>(&bytes) {
        for (name, value) in &prior.values {
            let _ = registry::restore_value(Hive::LocalMachine, WU_PATH, name, value, &None);
        }
    }
    let _ = std::fs::remove_file(file);
}

pub fn on_match_start() {
    if PAUSE_UPDATES.load(Ordering::SeqCst) {
        let _ = pause_updates();
    }
}

pub fn on_match_end() {
    resume_updates();
    restore_priorities();
}

#[cfg(test)]
mod tests {
    #[test]
    fn formats_utc() {
        assert_eq!(super::iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(super::iso_utc(1_792_310_400), "2026-10-18T08:00:00Z");
        assert_eq!(super::iso_utc(951_782_400), "2000-02-29T00:00:00Z");
    }
}
