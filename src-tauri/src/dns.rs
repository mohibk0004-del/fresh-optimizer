//! DNS server switcher for the active adapter. The original setting (automatic
//! or a static list) is recorded first, so Undo restores it exactly.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::hardware::NicInfo;
use crate::ping::{self, PingTarget};
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
    /// ICMP round trip to the primary server (None for Automatic or no reply).
    pub ping_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsStatus {
    pub adapter: Option<String>,
    /// Matching preset id, "auto", or "custom".
    pub current: String,
    pub servers: Vec<String>,
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

    let pings = if measure {
        let targets: Vec<PingTarget> = PRESETS
            .iter()
            .filter(|p| !p.servers.is_empty())
            .map(|p| PingTarget { label: p.id.into(), host: p.servers[0].into() })
            .collect();
        ping::probe(targets, 4)
    } else {
        Vec::new()
    };

    DnsStatus {
        adapter: nic.map(|n| n.name.clone()),
        current,
        servers,
        options: PRESETS
            .iter()
            .map(|p| DnsOption {
                id: p.id,
                name: p.name,
                servers: p.servers.to_vec(),
                ping_ms: pings.iter().find(|s| s.label == p.id && s.received > 0).map(|s| s.avg_ms),
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
