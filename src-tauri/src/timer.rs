//! High-resolution system timer. FO holds a 0.5 ms request only while a
//! supported game is running and releases it the moment the last one exits.

use std::sync::atomic::{AtomicBool, Ordering};

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
