//! NIC advanced-property editor and TCP/IP stack helpers.
//! Properties are matched by standardized `RegistryKeyword` (e.g. `*EEE`), so a
//! NIC that lacks a property is reported as "not supported" instead of failing.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::restore::{Entry, RestoreStore};
use crate::util::{self, ps_quote};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NicProperty {
    pub keyword: String,
    pub display_name: String,
    pub value: String,
    pub valid_values: Vec<String>,
}

/// One desired change: keyword -> target value.
pub struct NicTarget {
    pub keyword: &'static str,
    pub value: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NicChange {
    pub keyword: String,
    pub display_name: String,
    pub from: String,
    pub to: String,
}

pub const EEE_TARGETS: &[NicTarget] = &[
    NicTarget { keyword: "*EEE", value: "0" },
    NicTarget { keyword: "EEELinkAdvertisement", value: "0" },
    NicTarget { keyword: "AdvancedEEE", value: "0" },
    NicTarget { keyword: "EnableGreenEthernet", value: "0" },
    NicTarget { keyword: "GreenEthernet", value: "0" },
    NicTarget { keyword: "PowerSavingMode", value: "0" },
];

pub const INTERRUPT_TARGETS: &[NicTarget] = &[NicTarget { keyword: "*InterruptModeration", value: "0" }];

pub const RSS_LSO_TARGETS: &[NicTarget] = &[
    NicTarget { keyword: "*RSS", value: "1" },
    NicTarget { keyword: "*LsoV2IPv4", value: "0" },
    NicTarget { keyword: "*LsoV2IPv6", value: "0" },
];

pub const WATCHED_KEYWORDS: &[&str] = &[
    "*EEE", "EEELinkAdvertisement", "AdvancedEEE", "EnableGreenEthernet", "GreenEthernet", "PowerSavingMode",
    "*InterruptModeration", "*RSS", "*LsoV2IPv4", "*LsoV2IPv6",
];

pub fn read_properties(adapter: &str) -> AppResult<Vec<NicProperty>> {
    let keywords = WATCHED_KEYWORDS.iter().map(|k| ps_quote(k)).collect::<Vec<_>>().join(",");
    let script = format!(
        "$k=@({keywords});\
         $r=@(Get-NetAdapterAdvancedProperty -Name {name} -AllProperties -ErrorAction Stop | \
           Where-Object {{ $k -contains $_.RegistryKeyword }} | ForEach-Object {{ [pscustomobject]@{{ \
             keyword=[string]$_.RegistryKeyword; displayName=[string]$_.DisplayName; \
             value=[string](($_.RegistryValue) -join ','); validValues=@($_.ValidRegistryValues | ForEach-Object {{ [string]$_ }}) }} }});\
         ConvertTo-Json -InputObject $r -Depth 4 -Compress",
        name = ps_quote(adapter)
    );
    let out = util::powershell(&script)?;
    let trimmed = out.trim();
    if trimmed.is_empty() || trimmed == "null" {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(trimmed)?)
}

pub fn set_nic_property(adapter: &str, keyword: &str, value: &str) -> AppResult<()> {
    let script = format!(
        "Set-NetAdapterAdvancedProperty -Name {} -RegistryKeyword {} -RegistryValue {} -NoRestart -ErrorAction Stop",
        ps_quote(adapter),
        ps_quote(keyword),
        ps_quote(value)
    );
    util::powershell(&script).map(|_| ())
}

pub fn restart_adapter(adapter: &str) -> AppResult<()> {
    util::powershell(&format!("Restart-NetAdapter -Name {} -Confirm:$false -ErrorAction Stop", ps_quote(adapter))).map(|_| ())
}

/// Applies the subset of `targets` this NIC supports. Unsupported keywords and
/// values outside the driver's ValidRegistryValues are skipped, never forced.
/// Does NOT restart the adapter; the caller batches one restart per boost.
pub fn apply_targets(store: &RestoreStore, tweak: &str, adapter: &str, targets: &[NicTarget]) -> AppResult<Vec<NicChange>> {
    let props = read_properties(adapter)?;
    let mut changes = Vec::new();
    for t in targets {
        let Some(p) = props.iter().find(|p| p.keyword.eq_ignore_ascii_case(t.keyword)) else { continue };
        if !p.valid_values.is_empty() && !p.valid_values.iter().any(|v| v == t.value) {
            continue;
        }
        if p.value == t.value {
            continue;
        }
        store.record(
            tweak,
            Entry::NicProperty { adapter: adapter.to_string(), keyword: p.keyword.clone(), prior: p.value.clone() },
        )?;
        set_nic_property(adapter, &p.keyword, t.value)?;
        changes.push(NicChange {
            keyword: p.keyword.clone(),
            display_name: p.display_name.clone(),
            from: p.value.clone(),
            to: t.value.to_string(),
        });
    }
    Ok(changes)
}

pub fn read_autotuning() -> AppResult<String> {
    let out = util::run_hidden("netsh", &["interface", "tcp", "show", "global"])?;
    out.lines()
        .find(|l| l.to_ascii_lowercase().contains("auto-tuning"))
        .and_then(|l| l.split(':').nth(1))
        .map(|v| v.trim().to_ascii_lowercase())
        .filter(|v| !v.is_empty())
        .ok_or_else(|| AppError::Unsupported("could not parse netsh autotuning level".into()))
}

pub fn set_autotuning(level: &str) -> AppResult<()> {
    const ALLOWED: &[&str] = &["disabled", "highlyrestricted", "restricted", "normal", "experimental"];
    let level = level.to_ascii_lowercase();
    if !ALLOWED.contains(&level.as_str()) {
        return Err(AppError::Other(format!("refusing unknown autotuning level '{level}'")));
    }
    util::run_hidden("netsh", &["interface", "tcp", "set", "global", &format!("autotuninglevel={level}")]).map(|_| ())
}

pub fn flush_dns() -> AppResult<String> {
    util::run_hidden("ipconfig", &["/flushdns"]).map(|s| s.trim().lines().last().unwrap_or("DNS cache flushed").to_string())
}

pub fn reset_winsock() -> AppResult<String> {
    util::run_hidden("netsh", &["winsock", "reset"])?;
    Ok("Winsock catalog reset. Restart Windows to complete.".into())
}
