//! Multi-threaded ICMP jitter / packet-loss probe (IcmpSendEcho, no raw sockets,
//! no driver). Each target gets its own thread and its own ICMP handle.

use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
use windows_sys::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingTarget {
    pub label: String,
    pub host: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingStats {
    pub label: String,
    pub host: String,
    pub resolved: Option<String>,
    pub sent: u32,
    pub received: u32,
    pub loss_pct: f64,
    pub min_ms: f64,
    pub avg_ms: f64,
    pub max_ms: f64,
    /// RFC 3550-style mean absolute delta between consecutive RTTs.
    pub jitter_ms: f64,
    pub error: Option<String>,
}

pub fn default_targets() -> Vec<PingTarget> {
    [
        ("Cloudflare Edge", "1.1.1.1"),
        ("Google Edge", "8.8.8.8"),
        ("Riot Games", "riotgames.com"),
        ("Valve / Steam", "steampowered.com"),
    ]
    .into_iter()
    .map(|(l, h)| PingTarget { label: l.into(), host: h.into() })
    .collect()
}

fn resolve(host: &str) -> Option<Ipv4Addr> {
    if let Ok(ip) = host.parse::<Ipv4Addr>() {
        return Some(ip);
    }
    (host, 0).to_socket_addrs().ok()?.find_map(|a| match a.ip() {
        IpAddr::V4(v4) => Some(v4),
        IpAddr::V6(_) => None,
    })
}

struct Icmp(windows_sys::Win32::Foundation::HANDLE);

impl Icmp {
    fn open() -> Option<Self> {
        // SAFETY: no arguments; returns INVALID_HANDLE_VALUE on failure.
        let h = unsafe { IcmpCreateFile() };
        if h == INVALID_HANDLE_VALUE || h.is_null() {
            None
        } else {
            Some(Icmp(h))
        }
    }

    /// Returns RTT in ms (sub-ms resolution from QPC) or None on timeout/loss.
    fn echo(&self, ip: Ipv4Addr, timeout_ms: u32) -> Option<f64> {
        let payload = [0x41u8; 32];
        let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + payload.len() + 8 + 16];
        let dest = u32::from_ne_bytes(ip.octets());
        let start = Instant::now();
        // SAFETY: payload and reply buffers are valid for the given sizes.
        let n = unsafe {
            IcmpSendEcho(
                self.0,
                dest,
                payload.as_ptr().cast(),
                payload.len() as u16,
                std::ptr::null(),
                reply.as_mut_ptr().cast(),
                reply.len() as u32,
                timeout_ms,
            )
        };
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        if n == 0 {
            return None;
        }
        // SAFETY: reply buffer starts with an ICMP_ECHO_REPLY when n > 0.
        let r = unsafe { std::ptr::read_unaligned(reply.as_ptr() as *const ICMP_ECHO_REPLY) };
        if r.Status != 0 {
            return None;
        }
        // QPC-measured elapsed includes ~tens of µs API overhead; prefer it over the
        // 1 ms-granular RoundTripTime unless they disagree wildly.
        let api = r.RoundTripTime as f64;
        Some(if (elapsed - api).abs() <= 1.5 { elapsed } else { api.max(0.1) })
    }
}

impl Drop for Icmp {
    fn drop(&mut self) {
        // SAFETY: handle came from IcmpCreateFile.
        unsafe { IcmpCloseHandle(self.0) };
    }
}

fn probe_one(target: PingTarget, samples: u32, interval: Duration) -> PingStats {
    let mut stats = PingStats {
        label: target.label.clone(),
        host: target.host.clone(),
        resolved: None,
        sent: 0,
        received: 0,
        loss_pct: 0.0,
        min_ms: 0.0,
        avg_ms: 0.0,
        max_ms: 0.0,
        jitter_ms: 0.0,
        error: None,
    };
    let Some(ip) = resolve(&target.host) else {
        stats.error = Some("DNS resolution failed".into());
        return stats;
    };
    stats.resolved = Some(ip.to_string());
    let Some(icmp) = Icmp::open() else {
        stats.error = Some("IcmpCreateFile failed".into());
        return stats;
    };

    let mut rtts = Vec::with_capacity(samples as usize);
    for i in 0..samples {
        stats.sent += 1;
        if let Some(rtt) = icmp.echo(ip, 1000) {
            rtts.push(rtt);
        }
        if i + 1 < samples {
            thread::sleep(interval);
        }
    }
    stats.received = rtts.len() as u32;
    stats.loss_pct = round2(100.0 * (stats.sent - stats.received) as f64 / stats.sent.max(1) as f64);
    if !rtts.is_empty() {
        stats.min_ms = round2(rtts.iter().cloned().fold(f64::INFINITY, f64::min));
        stats.max_ms = round2(rtts.iter().cloned().fold(0.0, f64::max));
        stats.avg_ms = round2(rtts.iter().sum::<f64>() / rtts.len() as f64);
        if rtts.len() > 1 {
            let d: f64 = rtts.windows(2).map(|w| (w[1] - w[0]).abs()).sum();
            stats.jitter_ms = round2(d / (rtts.len() - 1) as f64);
        }
    } else {
        stats.error = Some("No replies (host may filter ICMP)".into());
    }
    stats
}

pub fn probe(targets: Vec<PingTarget>, samples: u32) -> Vec<PingStats> {
    let samples = samples.clamp(4, 200);
    let interval = Duration::from_millis(100);
    let handles: Vec<_> = targets
        .into_iter()
        .map(|t| thread::spawn(move || probe_one(t, samples, interval)))
        .collect();
    handles.into_iter().filter_map(|h| h.join().ok()).collect()
}

/// Single echo for the live graph. None = lost.
pub fn once(host: &str) -> Option<f64> {
    let ip = resolve(host)?;
    Icmp::open()?.echo(ip, 1000).map(round2)
}

fn round2(v: f64) -> f64 {
    (v * 100.0).round() / 100.0
}
