//! Extra TCP/IP stack settings (the useful subset of SG TCP Optimizer).
//!
//! Values are read with PowerShell (locale-independent property names) and
//! written with netsh / Set-NetOffloadGlobalSetting. Every knob and value is an
//! allowlisted enum, so a restore point can never smuggle in a command.

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::util;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Knob {
    /// Window Scaling heuristics (Windows can shrink the receive window).
    Heuristics,
    /// Congestion control provider for the Internet template.
    Congestion,
    /// Receive Segment Coalescing (merges incoming packets).
    Rsc,
    /// Packet Coalescing filter (batches incoming packets on some hardware).
    PacketCoalescing,
}

impl Knob {
    pub fn label(self) -> &'static str {
        match self {
            Knob::Heuristics => "TCP window scaling heuristics",
            Knob::Congestion => "TCP congestion control",
            Knob::Rsc => "Receive Segment Coalescing",
            Knob::PacketCoalescing => "Packet coalescing",
        }
    }

    fn allowed(self) -> &'static [&'static str] {
        match self {
            Knob::Heuristics | Knob::Rsc | Knob::PacketCoalescing => &["enabled", "disabled"],
            Knob::Congestion => &["cubic", "ctcp", "newreno", "dctcp", "bbr2"],
        }
    }
}

/// Current value, lower-case (e.g. "enabled", "cubic").
pub fn read(knob: Knob) -> AppResult<String> {
    let expr = match knob {
        Knob::Heuristics => "(Get-NetTCPSetting -SettingName Internet).ScalingHeuristics",
        Knob::Congestion => "(Get-NetTCPSetting -SettingName Internet).CongestionProvider",
        Knob::Rsc => "(Get-NetOffloadGlobalSetting).ReceiveSegmentCoalescing",
        Knob::PacketCoalescing => "(Get-NetOffloadGlobalSetting).PacketCoalescingFilter",
    };
    let v = util::powershell(&format!("[string]({expr})"))?.trim().to_ascii_lowercase();
    if knob.allowed().contains(&v.as_str()) {
        Ok(v)
    } else {
        Err(AppError::Unsupported(format!("{} isn't available on this version of Windows", knob.label())))
    }
}

pub fn write(knob: Knob, value: &str) -> AppResult<()> {
    let v = value.to_ascii_lowercase();
    if !knob.allowed().contains(&v.as_str()) {
        return Err(AppError::Other(format!("refusing unexpected value '{value}' for {}", knob.label())));
    }
    match knob {
        Knob::Heuristics => util::run_hidden("netsh", &["int", "tcp", "set", "heuristics", &v]).map(|_| ()),
        Knob::Congestion => {
            util::run_hidden("netsh", &["int", "tcp", "set", "supplemental", "template=internet", &format!("congestionprovider={v}")]).map(|_| ())
        }
        Knob::Rsc | Knob::PacketCoalescing => {
            let param = if knob == Knob::Rsc { "ReceiveSegmentCoalescing" } else { "PacketCoalescingFilter" };
            let state = if v == "enabled" { "Enabled" } else { "Disabled" };
            util::powershell(&format!("Set-NetOffloadGlobalSetting -{param} {state} -ErrorAction Stop")).map(|_| ())
        }
    }
}
