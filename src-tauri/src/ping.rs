//! Multi-threaded ICMP jitter / packet-loss probe (IcmpSendEcho, no raw sockets,
//! no driver). Each target gets its own thread and its own ICMP handle.

use std::net::{IpAddr, Ipv4Addr, ToSocketAddrs};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
use windows_sys::Win32::NetworkManagement::IpHelper::{IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY, IP_OPTION_INFORMATION};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PingTarget {
    pub label: String,
    pub host: String,
    /// What the target really is, so results are explained honestly:
    /// "edge" (public DNS edge), "valve_relay" (real CS2 relay), "riot_web".
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PingStats {
    pub label: String,
    pub host: String,
    pub kind: String,
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
    let mut t = vec![
        PingTarget { label: "Cloudflare".into(), host: "1.1.1.1".into(), kind: "edge".into() },
        PingTarget { label: "Google".into(), host: "8.8.8.8".into(), kind: "edge".into() },
    ];
    // Real Valve relay (CS2 match traffic goes through these). Skipped if Steam's list is unreachable.
    if let Some(relay) = crate::sdr::nearest() {
        t.push(PingTarget { label: format!("CS2 relay \u{b7} {}", relay.city), host: relay.ip, kind: "valve_relay".into() });
    }
    // VALORANT match servers don't answer pings; this is Riot's website network.
    t.push(PingTarget { label: "Riot network (website)".into(), host: "riotgames.com".into(), kind: "riot_web".into() });
    t
}

pub fn resolve(host: &str) -> Option<Ipv4Addr> {
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
        kind: target.kind.clone(),
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

// ------------------------------------------------------------------ route trace

/// Windows ICMP status for "TTL expired in transit" (an intermediate hop answered).
const IP_TTL_EXPIRED_TRANSIT: u32 = 11013;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hop {
    pub ttl: u8,
    /// Router that answered (None = it doesn't reply to traces, which is common).
    pub address: Option<String>,
    pub sent: u32,
    pub received: u32,
    pub loss_pct: f64,
    pub avg_ms: Option<f64>,
    pub best_ms: Option<f64>,
    pub worst_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    /// 10/8, 172.16/12, 192.168/16: inside a home network.
    pub private: bool,
    /// 100.64/10: carrier-grade NAT, i.e. inside your ISP.
    pub cgnat: bool,
    pub is_destination: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trace {
    pub host: String,
    pub resolved: Option<String>,
    pub reached: bool,
    pub hops: Vec<Hop>,
    pub error: Option<String>,
}

impl Icmp {
    /// Echo with a given TTL. Returns (responder, status, rtt_ms).
    fn echo_ttl(&self, ip: Ipv4Addr, ttl: u8, timeout_ms: u32) -> Option<(Ipv4Addr, u32, f64)> {
        let payload = [0x42u8; 32];
        let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + payload.len() + 8 + 64];
        let opts = IP_OPTION_INFORMATION { Ttl: ttl, Tos: 0, Flags: 0, OptionsSize: 0, OptionsData: std::ptr::null_mut() };
        let start = Instant::now();
        // SAFETY: buffers and options struct are valid for the duration of the call.
        let n = unsafe {
            IcmpSendEcho(
                self.0,
                u32::from_ne_bytes(ip.octets()),
                payload.as_ptr().cast(),
                payload.len() as u16,
                &opts,
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
        Some((Ipv4Addr::from(r.Address.to_ne_bytes()), r.Status, elapsed))
    }
}

fn is_private(ip: Ipv4Addr) -> bool {
    ip.is_private() || ip.is_loopback() || ip.is_link_local()
}

fn is_cgnat(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    o[0] == 100 && (64..=127).contains(&o[1])
}

/// Traceroute with repeated probes per hop, all TTLs in parallel (a few seconds).
pub fn trace(host: &str, max_hops: u8, probes: u32) -> Trace {
    let mut out = Trace { host: host.into(), resolved: None, reached: false, hops: Vec::new(), error: None };
    let Some(ip) = resolve(host) else {
        out.error = Some("DNS resolution failed".into());
        return out;
    };
    out.resolved = Some(ip.to_string());
    let max_hops = max_hops.clamp(4, 30);
    let probes = probes.clamp(3, 20);

    type Sample = (Option<Ipv4Addr>, Option<f64>, bool);
    let mut results: Vec<(u8, Vec<Sample>)> = thread::scope(|sc| {
        let handles: Vec<_> = (1..=max_hops)
            .map(|ttl| {
                sc.spawn(move || {
                    let mut v: Vec<Sample> = Vec::new();
                    let Some(icmp) = Icmp::open() else { return (ttl, v) };
                    for i in 0..probes {
                        match icmp.echo_ttl(ip, ttl, 900) {
                            Some((from, status, rtt)) if status == 0 || status == IP_TTL_EXPIRED_TRANSIT => v.push((Some(from), Some(rtt), status == 0)),
                            _ => v.push((None, None, false)),
                        }
                        if i + 1 < probes {
                            thread::sleep(Duration::from_millis(120));
                        }
                    }
                    (ttl, v)
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    results.sort_by_key(|(t, _)| *t);

    for (ttl, samples) in results {
        let address = samples.iter().find_map(|(a, _, _)| *a);
        let rtts: Vec<f64> = samples.iter().filter_map(|(_, r, _)| *r).collect();
        let dest = samples.iter().any(|(_, _, d)| *d) || address == Some(ip);
        let sent = samples.len() as u32;
        let received = rtts.len() as u32;
        let jitter = (rtts.len() > 1).then(|| rtts.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f64>() / (rtts.len() - 1) as f64);
        out.hops.push(Hop {
            ttl,
            address: address.map(|a| a.to_string()),
            sent,
            received,
            loss_pct: round2(100.0 * (sent - received) as f64 / sent.max(1) as f64),
            avg_ms: (!rtts.is_empty()).then(|| round2(rtts.iter().sum::<f64>() / rtts.len() as f64)),
            best_ms: rtts.iter().cloned().reduce(f64::min).map(round2),
            worst_ms: rtts.iter().cloned().reduce(f64::max).map(round2),
            jitter_ms: jitter.map(round2),
            private: address.map(is_private).unwrap_or(false),
            cgnat: address.map(is_cgnat).unwrap_or(false),
            is_destination: dest,
        });
        if dest {
            out.reached = true;
            break;
        }
    }
    if !out.reached {
        while out.hops.last().is_some_and(|h| h.address.is_none()) {
            out.hops.pop();
        }
    }
    out
}
