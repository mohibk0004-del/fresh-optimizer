//! DPC/ISR interference probe (LatencyMon-style, user-mode).
//! A TIME_CRITICAL thread spins on the QPC clock for a short window; any gap
//! between consecutive reads means the core was taken away from us, almost
//! always by an interrupt or DPC. Long or frequent gaps are exactly what causes
//! frametime spikes and bad 1% lows. Runs on demand only (~300 ms of one core).

use std::time::{Duration, Instant};

use serde::Serialize;
use windows_sys::Win32::System::Threading::{GetCurrentThread, GetThreadPriority, SetThreadPriority, THREAD_PRIORITY_TIME_CRITICAL};

use crate::error::AppResult;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatencyReport {
    pub window_ms: u32,
    /// Number of interruptions longer than the noise floor.
    pub interruptions: u32,
    pub median_us: f64,
    pub p99_us: f64,
    pub max_us: f64,
    pub over_100us: u32,
    /// Share of the window stolen from the thread.
    pub stolen_pct: f64,
    /// 0..100, higher is better.
    pub score: u32,
    pub verdict: String,
}

const NOISE_FLOOR: Duration = Duration::from_micros(5);

pub fn measure(window_ms: u32) -> AppResult<LatencyReport> {
    let window = Duration::from_millis(window_ms.clamp(100, 2000) as u64);

    // SAFETY: pseudo-handle for the current thread; priority restored below.
    let thread = unsafe { GetCurrentThread() };
    let prev = unsafe { GetThreadPriority(thread) };
    unsafe { SetThreadPriority(thread, THREAD_PRIORITY_TIME_CRITICAL) };

    let mut gaps: Vec<f64> = Vec::with_capacity(4096);
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
            break;
        }
    }
    let elapsed_us = start.elapsed().as_secs_f64() * 1e6;
    unsafe { SetThreadPriority(thread, prev) };

    gaps.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let pick = |q: f64| if gaps.is_empty() { 0.0 } else { gaps[((gaps.len() as f64 * q) as usize).min(gaps.len() - 1)] };
    let max = gaps.last().copied().unwrap_or(0.0);
    let over_100 = gaps.iter().filter(|g| **g > 100.0).count() as u32;
    let stolen: f64 = gaps.iter().sum();

    // Worst single stall dominates (one long DPC = one dropped frame); frequent
    // >100 µs stalls erode 1% lows.
    let penalty = (max / 12.0).min(60.0) + (over_100 as f64 * 3.0).min(40.0);
    let score = (100.0 - penalty).clamp(0.0, 100.0).round() as u32;
    let verdict = match score {
        85..=100 => "Excellent",
        65..=84 => "Good",
        40..=64 => "Fair - check drivers",
        _ => "Poor - driver DPC spikes likely",
    }
    .to_string();

    Ok(LatencyReport {
        window_ms: window.as_millis() as u32,
        interruptions: gaps.len() as u32,
        median_us: round1(pick(0.5)),
        p99_us: round1(pick(0.99)),
        max_us: round1(max),
        over_100us: over_100,
        stolen_pct: (stolen / elapsed_us * 10_000.0).round() / 100.0,
        score,
        verdict,
    })
}

fn round1(v: f64) -> f64 {
    (v * 10.0).round() / 10.0
}
