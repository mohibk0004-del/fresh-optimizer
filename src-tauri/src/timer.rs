//! High-resolution system timer. FO holds a 0.5 ms request only while a
//! supported game is running and releases it the moment the last one exits.

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

use serde::Serialize;
use windows_sys::Win32::System::Threading::{
    GetCurrentProcess, ProcessPowerThrottling, SetProcessInformation, PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
    PROCESS_POWER_THROTTLING_STATE,
};

#[link(name = "ntdll")]
extern "system" {
    fn NtSetTimerResolution(desired: u32, set: u8, current: *mut u32) -> i32;
    fn NtQueryTimerResolution(coarsest: *mut u32, finest: *mut u32, current: *mut u32) -> i32;
}

/// 0.5 ms expressed in 100 ns units.
const TARGET_100NS: u32 = 5_000;

static HELD: AtomicBool = AtomicBool::new(false);

/// 0 = never, 1 = during matches (default), 2 = always while FreshOptimizer runs.
static MODE: AtomicU8 = AtomicU8::new(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Off,
    Match,
    Always,
}

pub fn mode() -> Mode {
    match MODE.load(Ordering::SeqCst) {
        0 => Mode::Off,
        2 => Mode::Always,
        _ => Mode::Match,
    }
}

/// Changes the policy and applies it right away. `in_match` tells us whether
/// the engine currently has a game running (for Match mode).
pub fn set_mode(m: Mode, in_match: bool) {
    MODE.store(match m { Mode::Off => 0, Mode::Match => 1, Mode::Always => 2 }, Ordering::SeqCst);
    match m {
        Mode::Always => {
            request();
        }
        Mode::Match if in_match => {
            request();
        }
        _ => release(),
    }
}

/// Called by the match engine when a game starts.
pub fn on_match_start() -> f64 {
    if mode() == Mode::Off {
        return status().current_ms;
    }
    request()
}

/// Called by the match engine when the last game exits.
pub fn on_match_end() {
    if mode() != Mode::Always {
        release();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerStatus {
    pub current_ms: f64,
    pub finest_ms: f64,
    pub coarsest_ms: f64,
    pub held_by_app: bool,
}

pub fn status() -> TimerStatus {
    let (mut coarse, mut fine, mut cur) = (0u32, 0u32, 0u32);
    // SAFETY: three valid out-pointers.
    unsafe { NtQueryTimerResolution(&mut coarse, &mut fine, &mut cur) };
    TimerStatus {
        current_ms: cur as f64 / 10_000.0,
        finest_ms: fine as f64 / 10_000.0,
        coarsest_ms: coarse as f64 / 10_000.0,
        held_by_app: HELD.load(Ordering::Relaxed),
    }
}

/// Windows 11 ignores timer requests from occluded/minimized processes unless
/// the process opts out of that power-throttling behaviour.
fn opt_out_of_timer_throttling() {
    let state = PROCESS_POWER_THROTTLING_STATE {
        Version: 1,
        ControlMask: PROCESS_POWER_THROTTLING_IGNORE_TIMER_RESOLUTION,
        StateMask: 0,
    };
    // SAFETY: pointer/size describe a valid PROCESS_POWER_THROTTLING_STATE.
    unsafe {
        SetProcessInformation(
            GetCurrentProcess(),
            ProcessPowerThrottling,
            (&state as *const PROCESS_POWER_THROTTLING_STATE).cast(),
            std::mem::size_of::<PROCESS_POWER_THROTTLING_STATE>() as u32,
        )
    };
}

pub fn request() -> f64 {
    if HELD.swap(true, Ordering::SeqCst) {
        return status().current_ms;
    }
    opt_out_of_timer_throttling();
    let (mut coarse, mut fine, mut cur) = (0u32, 0u32, 0u32);
    // SAFETY: valid out-pointers; NtSetTimerResolution clamps to hardware limits.
    unsafe {
        NtQueryTimerResolution(&mut coarse, &mut fine, &mut cur);
        let desired = TARGET_100NS.max(fine);
        NtSetTimerResolution(desired, 1, &mut cur);
    }
    cur as f64 / 10_000.0
}

pub fn release() {
    if HELD.swap(false, Ordering::SeqCst) {
        let mut cur = 0u32;
        // SAFETY: valid out-pointer; set=0 drops this process's request.
        unsafe { NtSetTimerResolution(TARGET_100NS, 0, &mut cur) };
    }
}
