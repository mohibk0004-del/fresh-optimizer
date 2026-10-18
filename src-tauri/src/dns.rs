//! DNS server switcher for the active adapter. The original setting (automatic
//! or a static list) is recorded first, so Undo restores it exactly.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::hardware::NicInfo;
use crate::registry::{self, Hive};
use crate::restore::{Entry, RestoreStore};
use crate::util::{self, ps_quote};

pub struct Preset {
    pub id: &'static str,
    pub name: &'static str,
    pub servers: &'static [&'static str],
}

pub const PRESETS: &[Preset] = &[
    Preset { id: "auto", name: "Automatic", servers: &[] },
    Preset { id: "cloudflare", name: "Cloudflare", servers: &["1.1.1.1", "1.0.0.1"] },
    Preset { id: "google", name: "Google", servers: &["8.8.8.8", "8.8.4.4"] },
    Preset { id: "quad9", name: "Quad9", servers: &["9.9.9.9", "149.112.112.112"] },
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsOption {
    pub id: &'static str,
    pub name: &'static str,
    pub servers: Vec<&'static str>,
    /// Median time for a real DNS lookup against the primary server
    /// (None = not measured, unreachable, or Automatic while not active).
    pub lookup_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsStatus {
    pub adapter: Option<String>,
    /// Matching preset id, "auto", or "custom".
    pub current: String,
    pub servers: Vec<String>,
    /// Servers Windows actually uses right now (from DHCP when Automatic).
    pub effective_servers: Vec<String>,
    pub current_lookup_ms: Option<f64>,
    pub options: Vec<DnsOption>,
}

fn iface_path(nic: &NicInfo) -> String {
    format!(r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{}", nic.interface_guid.to_ascii_lowercase())
}

/// Statically configured servers ("" when the adapter gets DNS automatically).
fn static_servers(nic: &NicInfo) -> String {
    registry::read_string(Hive::LocalMachine, &iface_path(nic), "NameServer").unwrap_or_default()
}

fn split(list: &str) -> Vec<String> {
    list.split([',', ' ']).filter(|s| !s.is_empty()).map(String::from).collect()
}

/// Static servers on the adapter with this interface index ("" = automatic).
pub fn static_servers_by_index(if_index: u32) -> String {
    let guid = util::powershell(&format!("(Get-NetAdapter -InterfaceIndex {if_index} -ErrorAction SilentlyContinue).InterfaceGuid"))
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if guid.is_empty() {
        return "(adapter not found)".into();
    }
    registry::read_string(Hive::LocalMachine, &format!(r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{guid}"), "NameServer").unwrap_or_default()
}

pub fn status(nic: Option<&NicInfo>, measure: bool) -> DnsStatus {
    let servers = nic.map(|n| split(&static_servers(n))).unwrap_or_default();
    let current = if servers.is_empty() {
        "auto".to_string()
    } else {
        PRESETS
            .iter()
            .find(|p| !p.servers.is_empty() && p.servers[0] == servers[0])
            .map(|p| p.id.to_string())
            .unwrap_or_else(|| "custom".into())
    };

    // Real DNS lookups (not ICMP ping): what a game or browser actually waits for.
    let effective = if measure { nic.map(effective_servers).unwrap_or_default() } else { Vec::new() };
    let jobs: Vec<(&'static str, String)> = if measure {
        let mut j: Vec<(&'static str, String)> = PRESETS.iter().filter(|p| !p.servers.is_empty()).map(|p| (p.id, p.servers[0].to_string())).collect();
        // Whatever is in use right now (Automatic, a preset or custom servers).
        if let Some(first) = effective.first() {
            j.push(("current", first.clone()));
        }
        j
    } else {
        Vec::new()
    };
    let timings: Vec<(&'static str, Option<f64>)> = std::thread::scope(|sc| {
        let handles: Vec<_> = jobs.iter().map(|(id, ip)| sc.spawn(move || (*id, bench_server(ip)))).collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });
    let lookup = |id: &str| timings.iter().find(|(i, _)| *i == id).and_then(|(_, t)| *t);
    let current_lookup = lookup("current");
    let auto_lookup = current_lookup.filter(|_| current == "auto");

    DnsStatus {
        adapter: nic.map(|n| n.name.clone()),
        current_lookup_ms: current_lookup,
        effective_servers: effective,
        current,
        servers,
        options: PRESETS
            .iter()
            .map(|p| DnsOption {
                id: p.id,
                name: p.name,
                servers: p.servers.to_vec(),
                lookup_ms: if p.id == "auto" { auto_lookup } else { lookup(p.id) },
            })
            .collect(),
    }
}

fn apply_servers(if_index: u32, servers: &[String]) -> AppResult<()> {
    let script = if servers.is_empty() {
        format!("Set-DnsClientServerAddress -InterfaceIndex {if_index} -ResetServerAddresses -ErrorAction Stop")
    } else {
        let list = servers.iter().map(|s| ps_quote(s)).collect::<Vec<_>>().join(",");
        format!("Set-DnsClientServerAddress -InterfaceIndex {if_index} -ServerAddresses @({list}) -ErrorAction Stop")
    };
    util::powershell(&format!("{script}; Clear-DnsClientCache")).map(|_| ())
}

pub fn set(store: &RestoreStore, nic: &NicInfo, preset_id: &str) -> AppResult<()> {
    let preset = PRESETS.iter().find(|p| p.id == preset_id).ok_or_else(|| AppError::Other(format!("unknown DNS preset '{preset_id}'")))?;
    store.record("dns", Entry::Dns { if_index: nic.if_index, adapter: nic.name.clone(), prior: static_servers(nic) })?;
    apply_servers(nic.if_index, &preset.servers.iter().map(|s| s.to_string()).collect::<Vec<_>>())?;
    store.mark_applied("dns");
    Ok(())
}

/// Rollback hook for `Entry::Dns`.
pub fn restore(if_index: u32, prior: &str) -> AppResult<()> {
    apply_servers(if_index, &split(prior))
}

/// Effective DNS servers Windows is using on this adapter right now
/// (static or from DHCP).
fn effective_servers(nic: &NicInfo) -> Vec<String> {
    util::powershell(&format!(
        "(Get-DnsClientServerAddress -InterfaceIndex {} -AddressFamily IPv4 -ErrorAction SilentlyContinue).ServerAddresses -join ','",
        nic.if_index
    ))
    .map(|o| split(o.trim()))
    .unwrap_or_default()
}

/// Builds a minimal DNS A query (RFC 1035) with recursion desired.
fn build_query(id: u16, name: &str) -> Vec<u8> {
    let mut q = Vec::with_capacity(32 + name.len());
    q.extend_from_slice(&id.to_be_bytes());
    q.extend_from_slice(&[0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    for label in name.split('.') {
        q.push(label.len() as u8);
        q.extend_from_slice(label.as_bytes());
    }
    q.extend_from_slice(&[0x00, 0x00, 0x01, 0x00, 0x01]);
    q
}

/// One timed lookup. None on timeout, mismatched reply or server error.
fn lookup_once(server: &str, name: &str, id: u16) -> Option<f64> {
    use std::net::UdpSocket;
    use std::time::{Duration, Instant};
    let sock = UdpSocket::bind("0.0.0.0:0").ok()?;
    sock.set_read_timeout(Some(Duration::from_millis(1500))).ok()?;
    sock.connect((server, 53)).ok()?;
    let start = Instant::now();
    sock.send(&build_query(id, name)).ok()?;
    let mut buf = [0u8; 512];
    loop {
        let n = sock.recv(&mut buf).ok()?;
        if n >= 4 && u16::from_be_bytes([buf[0], buf[1]]) == id {
            let rcode = buf[3] & 0x0F;
            return (rcode == 0).then(|| start.elapsed().as_secs_f64() * 1000.0);
        }
    }
}

/// Median of several lookups for popular names (normally cached by the
/// resolver, which matches everyday browsing and game-server lookups).
pub fn bench_server(server: &str) -> Option<f64> {
    const NAMES: [&str; 5] = ["www.google.com", "www.cloudflare.com", "www.microsoft.com", "steamcommunity.com", "www.riotgames.com"];
    let seed = std::process::id() as u16 ^ (crate::util::now_unix() as u16);
    let mut times: Vec<f64> = NAMES
        .iter()
        .enumerate()
        .filter_map(|(i, n)| lookup_once(server, n, seed.wrapping_add(i as u16 * 7919)))
        .collect();
    if times.len() < 3 {
        return None;
    }
    times.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    Some((times[times.len() / 2] * 10.0).round() / 10.0)
}
