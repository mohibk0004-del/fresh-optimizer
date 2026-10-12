//! DPC/ISR interference probe (LatencyMon-style, user mode).
//!
//! A TIME_CRITICAL thread spins on the QPC clock; any gap between consecutive
//! reads means the core was taken away from it, almost always by an interrupt
//! or DPC. Those stalls are what cause frametime spikes and bad 1% lows.
//!
//! Honesty notes:
//! * One short window is dominated by whichever random stall happened to land
//!   in it, so a single "worst gap" swings wildly between runs. Instead we run
//!   many short windows and report the *typical* window (median of each
//!   window's worst stall), the worst one, and how often long stalls happen.
//! * The score is computed only from the typical value and the stall rate, so
//!   one unlucky spike can't move it much. We still return the run-to-run
//!   spread so the UI can show it rather than pretend to more precision.

use std::time::{Duration, Instant};

use serde::Serialize;
use windows_sys::Win32::System::Threading::{GetCurrentThread, GetThreadPriority, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL};

use crate::error::AppResult;

const WINDOWS: usize = 16;
const WINDOW: Duration = Duration::from_millis(250);
const NOISE_FLOOR: Duration = Duration::from_micros(5);
const LONG_STALL_US: f64 = 100.0;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyReport {
    /// Total time measured.
    pub duration_ms: u32,
    /// Median of each window's worst stall: what a normal moment looks like.
    pub typical_us: f64,
    /// Worst single stall seen in the whole run.
    pub max_us: f64,
    /// Lowest and highest per-window worst stall: the spread within this run.
    pub range_low_us: f64,
    pub range_high_us: f64,
    /// Stalls longer than 100 µs per second in a typical window (median).
    pub long_stalls_per_sec: f64,
    /// Windows (out of `windows_total`) hit by a burst of long stalls.
    pub burst_windows: u32,
    pub windows_total: u32,
    pub over_100us: u32,
    /// Share of the run stolen from the measuring thread.
    pub stolen_pct: f64,
    /// 0..100, higher is better. Derived from typical + stall rate only.
    pub score: u32,
    pub verdict: String,
}

fn spin(window: Duration, gaps: &mut Vec<f64>) -> f64 {
    let start = Instant::now();
    let mut last = start;
    loop {
        let now = Instant::now();
        let d = now - last;
        if d > NOISE_FLOOR {
            gaps.push(d.as_secs_f64() * 1e6);
        }
        last = now;
        if now - start >= window {
            return start.elapsed().as_secs_f64() * 1e6;
        }
    }
}

fn median(v: &mut [f64]) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

/// `_legacy_window_ms` is ignored; kept so callers don't change shape.
pub fn measure(_legacy_window_ms: u32) -> AppResult<LatencyReport> {
    // SAFETY: pseudo-handle for the current thread; priority restored below.
    let thread = unsafe { GetCurrentThread() };
    let prev = unsafe { GetThreadPriority(thread) };
    unsafe { SetThreadPriority(thread, THREAD_PRIORITY_TIME_CRITICAL) };

    let mut window_max = Vec::with_capacity(WINDOWS);
    let mut window_long = Vec::with_capacity(WINDOWS);
    let mut all_gaps: Vec<f64> = Vec::with_capacity(8192);
    let mut elapsed_us = 0.0;
    for _ in 0..WINDOWS {
        let mut gaps = Vec::with_capacity(512);
        elapsed_us += spin(WINDOW, &mut gaps);
        window_max.push(gaps.iter().cloned().fold(0.0, f64::max));
        window_long.push(gaps.iter().filter(|g| **g > LONG_STALL_US).count() as f64);
        all_gaps.extend(gaps);
        // Let the scheduler breathe between windows so we sample independent moments.
        std::thread::sleep(Duration::from_millis(8));
    }
    unsafe { SetThreadPriority(thread, prev) };

    let max = all_gaps.iter().cloned().fold(0.0, f64::max);
    let over_100 = all_gaps.iter().filter(|g| **g > LONG_STALL_US).count() as u32;
    let stolen: f64 = all_gaps.iter().sum();
    let seconds = elapsed_us / 1e6;
    let _ = seconds;
    // Median window, not the total: a short burst in a few windows is reported
    // separately (burst_windows) instead of dragging the whole score down.
    let burst_windows = window_long.iter().filter(|c| **c >= 3.0).count() as u32;
    let rate = median(&mut window_long) / WINDOW.as_secs_f64();

    let low = window_max.iter().cloned().fold(f64::INFINITY, f64::min);
    let high = window_max.iter().cloned().fold(0.0, f64::max);
    let typical = median(&mut window_max);

    // Typical stall carries most weight; frequent long stalls erode 1% lows.
    let penalty = (typical / 6.0).min(60.0) + (rate * 3.0).min(40.0);
    let score = (100.0 - penalty).clamp(0.0, 100.0).round() as u32;
    let verdict = match score {
        85..=100 => "Very smooth",
        65..=84 => "Smooth",
        40..=64 => "Some hiccups",
        _ => "Stuttery",
    }
    .to_string();

    Ok(LatencyReport {
        duration_ms: (elapsed_us / 1000.0).round() as u32,
        typical_us: round1(typical),
        max_us: round1(max),
        range_low_us: round1(if low.is_finite() { low } else { 0.0 }),
        range_high_us: round1(high),
        long_stalls_per_sec: round1(rate),
        burst_windows,
        windows_total: WINDOWS as u32,
        over_100us: over_100,
        stolen_pct: (stolen / elapsed_us * 10_000.0).round() / 100.0,
        score,
        verdict,
    })
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}
