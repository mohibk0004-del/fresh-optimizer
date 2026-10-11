//! Tweak catalog. Each tweak is idempotent, snapshots its baseline first, and
//! returns Applied / Skipped (unsupported here) / Failed - never panics.

use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::games::{self, GAMES};
use crate::hardware::NicInfo;
use crate::network;
use crate::power;
use crate::registry::{self, Hive};
use crate::restore::{Entry, RestoreStore};

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Network,
    Nic,
    System,
    Game,
    Power,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub category: Category,
    pub description: &'static str,
    pub default_on: bool,
    /// Shown as a caution badge in the UI.
    pub caution: Option<&'static str>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    Applied,
    Skipped,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TweakResult {
    pub id: String,
    pub status: Status,
    pub detail: String,
    pub needs_nic_restart: bool,
}

pub const CATALOG: &[TweakInfo] = &[
    TweakInfo { id: "nagle", name: "Disable Nagle's Algorithm", category: Category::Network,
        description: "TcpAckFrequency=1 and TCPNoDelay=1 on the active interface: no packet coalescing delay.",
        default_on: true, caution: None },
    TweakInfo { id: "net_throttling", name: "Remove Network Throttling", category: Category::Network,
        description: "NetworkThrottlingIndex=0xFFFFFFFF so MMCSS stops rate-limiting non-multimedia traffic.",
        default_on: true, caution: None },
    TweakInfo { id: "tcp_autotuning", name: "TCP Auto-Tuning: Normal", category: Category::Network,
        description: "netsh int tcp set global autotuninglevel=normal (restores a sane receive window).",
        default_on: true, caution: None },
    TweakInfo { id: "nic_eee", name: "Disable EEE / Green Ethernet", category: Category::Nic,
        description: "Turns off Energy Efficient Ethernet link power-saving that adds wake-up latency.",
        default_on: true, caution: Some("Brief NIC reconnect") },
    TweakInfo { id: "nic_interrupt", name: "Disable Interrupt Moderation", category: Category::Nic,
        description: "Delivers each packet interrupt immediately instead of batching (lower latency, slightly more CPU).",
        default_on: true, caution: Some("Brief NIC reconnect") },
    TweakInfo { id: "nic_rss_lso", name: "RSS On / LSO Off", category: Category::Nic,
        description: "Spreads receive work across cores and disables Large Send Offload burst batching.",
        default_on: true, caution: Some("Brief NIC reconnect") },
    TweakInfo { id: "gamedvr", name: "Disable Game DVR / Capture", category: Category::System,
        description: "Disables Xbox Game Bar background recording hooks via registry policy.",
        default_on: true, caution: None },
    TweakInfo { id: "game_mode", name: "Enable Windows Game Mode", category: Category::System,
        description: "Lets Windows prioritise the foreground game and pause background updates.",
        default_on: true, caution: None },
    TweakInfo { id: "mmcss_games", name: "MMCSS Games Profile", category: Category::System,
        description: "Raises the multimedia scheduler 'Games' task to High scheduling / GPU priority 8.",
        default_on: true, caution: None },
    TweakInfo { id: "global_timer", name: "Allow Global Timer Resolution", category: Category::System,
        description: "Windows 11: lets FO's 0.5 ms in-match timer request apply system-wide.",
        default_on: true, caution: None },
    TweakInfo { id: "fso", name: "Disable Fullscreen Optimizations", category: Category::Game,
        description: "Per-binary compatibility flag on each detected game executable.",
        default_on: true, caution: None },
    TweakInfo { id: "ifeo_priority", name: "Launch-Time High Priority", category: Category::Game,
        description: "IFEO PerfOptions CpuPriorityClass=High: Windows applies it at launch, no process handle needed.",
        default_on: true, caution: None },
    TweakInfo { id: "power_scheme", name: "Low-DPC Power Scheme", category: Category::Power,
        description: "Creates 'FO Low-DPC' (no core parking, 100% min state, ASPM off). Active only in-match.",
        default_on: true, caution: None },
    TweakInfo { id: "cstate_lock", name: "Lock Out CPU Idle States", category: Category::Power,
        description: "Disables processor idle (C-states) inside the in-match scheme. Lowest wake latency.",
        default_on: false, caution: Some("High temps / power draw") },
];

const MULTIMEDIA: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile";
const IFEO: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";

pub struct Ctx<'a> {
    pub store: &'a RestoreStore,
    pub nic: Option<&'a NicInfo>,
}

pub fn apply(id: &str, ctx: &Ctx) -> TweakResult {
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(id, ctx)));
    let (status, detail, needs_nic_restart) = match outcome {
        Ok(Ok(Outcome::Applied(d))) => (Status::Applied, d, false),
        Ok(Ok(Outcome::AppliedNic(d))) => (Status::Applied, d, true),
        Ok(Ok(Outcome::Skipped(d))) => (Status::Skipped, d, false),
        Ok(Err(e)) => (Status::Failed, e.to_string(), false),
        Err(_) => (Status::Failed, "internal error (recovered)".into(), false),
    };
    if matches!(status, Status::Applied) {
        ctx.store.mark_applied(id);
    }
    TweakResult { id: id.into(), status, detail, needs_nic_restart }
}

enum Outcome {
    Applied(String),
    AppliedNic(String),
    Skipped(String),
}

fn require_nic<'a>(ctx: &'a Ctx) -> Result<&'a NicInfo, Outcome> {
    ctx.nic.ok_or_else(|| Outcome::Skipped("No active network adapter with a default route".into()))
}

fn nic_tweak(ctx: &Ctx, id: &str, targets: &[network::NicTarget], label: &str) -> AppResult<Outcome> {
    let nic = match require_nic(ctx) {
        Ok(n) => n,
        Err(o) => return Ok(o),
    };
    let changes = match network::apply_targets(ctx.store, id, &nic.name, targets) {
        Ok(c) => c,
        Err(AppError::Command(msg)) if msg.contains("No MSFT_NetAdapterAdvancedPropertySettingData") => {
            return Ok(Outcome::Skipped(format!("'{}' exposes no advanced properties", nic.name)));
        }
        Err(e) => return Err(e),
    };
    if changes.is_empty() {
        let supported = network::read_properties(&nic.name)
            .map(|p| targets.iter().any(|t| p.iter().any(|x| x.keyword.eq_ignore_ascii_case(t.keyword))))
            .unwrap_or(false);
        return Ok(Outcome::Skipped(if supported {
            format!("{label} already optimal on '{}'", nic.name)
        } else {
            format!("'{}' driver does not support {label}", nic.description)
        }));
    }
    let list = changes.iter().map(|c| format!("{} {}→{}", c.display_name, c.from, c.to)).collect::<Vec<_>>().join(", ");
    Ok(Outcome::AppliedNic(list))
}

fn run(id: &str, ctx: &Ctx) -> AppResult<Outcome> {
    let s = ctx.store;
    match id {
        "nagle" => {
            let nic = match require_nic(ctx) {
                Ok(n) => n,
                Err(o) => return Ok(o),
            };
            if nic.interface_guid.is_empty() {
                return Ok(Outcome::Skipped("Adapter GUID unavailable".into()));
            }
            let path = format!(r"SYSTEM\CurrentControlSet\Services\Tcpip\Parameters\Interfaces\{}", nic.interface_guid.to_ascii_lowercase());
            if !registry::key_exists(Hive::LocalMachine, &path) {
                return Ok(Outcome::Skipped("TCP/IP interface key not found".into()));
            }
            registry::set_dword_tracked(s, id, Hive::LocalMachine, &path, "TcpAckFrequency", 1)?;
            registry::set_dword_tracked(s, id, Hive::LocalMachine, &path, "TCPNoDelay", 1)?;
            registry::set_dword_tracked(s, id, Hive::LocalMachine, &path, "TcpDelAckTicks", 0)?;
            Ok(Outcome::Applied(format!("Applied to '{}' (takes effect on new connections)", nic.name)))
        }
        "net_throttling" => {
            registry::set_dword_tracked(s, id, Hive::LocalMachine, MULTIMEDIA, "NetworkThrottlingIndex", 0xFFFF_FFFF)?;
            Ok(Outcome::Applied("NetworkThrottlingIndex = 0xFFFFFFFF".into()))
        }
        "tcp_autotuning" => {
            let current = network::read_autotuning()?;
            if current == "normal" {
                return Ok(Outcome::Skipped("Already 'normal'".into()));
            }
            s.record(id, Entry::TcpAutotuning { prior: current.clone() })?;
            network::set_autotuning("normal")?;
            Ok(Outcome::Applied(format!("{current} → normal")))
        }
        "nic_eee" => nic_tweak(ctx, id, network::EEE_TARGETS, "EEE / Green Ethernet"),
        "nic_interrupt" => nic_tweak(ctx, id, network::INTERRUPT_TARGETS, "Interrupt Moderation"),
        "nic_rss_lso" => nic_tweak(ctx, id, network::RSS_LSO_TARGETS, "RSS / LSO"),
        "gamedvr" => {
            registry::set_dword_tracked(s, id, Hive::CurrentUser, r"System\GameConfigStore", "GameDVR_Enabled", 0)?;
            registry::set_dword_tracked(s, id, Hive::CurrentUser, r"Software\Microsoft\Windows\CurrentVersion\GameDVR", "AppCaptureEnabled", 0)?;
            registry::set_dword_tracked(s, id, Hive::LocalMachine, r"SOFTWARE\Policies\Microsoft\Windows\GameDVR", "AllowGameDVR", 0)?;
            Ok(Outcome::Applied("Game DVR + background capture disabled".into()))
        }
        "game_mode" => {
            registry::set_dword_tracked(s, id, Hive::CurrentUser, r"Software\Microsoft\GameBar", "AutoGameModeEnabled", 1)?;
            registry::set_dword_tracked(s, id, Hive::CurrentUser, r"Software\Microsoft\GameBar", "AllowAutoGameMode", 1)?;
            Ok(Outcome::Applied("Game Mode active".into()))
        }
        "mmcss_games" => {
            let p = format!(r"{MULTIMEDIA}\Tasks\Games");
            registry::set_dword_tracked(s, id, Hive::LocalMachine, &p, "GPU Priority", 8)?;
            registry::set_dword_tracked(s, id, Hive::LocalMachine, &p, "Priority", 6)?;
            registry::set_string_tracked(s, id, Hive::LocalMachine, &p, "Scheduling Category", "High")?;
            registry::set_string_tracked(s, id, Hive::LocalMachine, &p, "SFIO Priority", "High")?;
            Ok(Outcome::Applied("Games task: High / GPU 8 / Priority 6".into()))
        }
        "global_timer" => {
            registry::set_dword_tracked(
                s, id, Hive::LocalMachine,
                r"SYSTEM\CurrentControlSet\Control\Session Manager\kernel",
                "GlobalTimerResolutionRequests", 1,
            )?;
            Ok(Outcome::Applied("Enabled (full effect after reboot)".into()))
        }
        "fso" => {
            let paths = games::installed_exe_paths();
            if paths.is_empty() {
                return Ok(Outcome::Skipped("No supported games installed".into()));
            }
            for p in &paths {
                registry::set_string_tracked(
                    s, id, Hive::CurrentUser,
                    r"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers",
                    p, "~ DISABLEDXMAXIMIZEDWINDOWEDMODE",
                )?;
            }
            Ok(Outcome::Applied(format!("{} game binaries flagged", paths.len())))
        }
        "ifeo_priority" => {
            let mut n = 0;
            for g in GAMES {
                for exe in g.processes {
                    let path = format!(r"{IFEO}\{exe}\PerfOptions");
                    registry::set_dword_tracked(s, id, Hive::LocalMachine, &path, "CpuPriorityClass", 3)?;
                    n += 1;
                }
            }
            Ok(Outcome::Applied(format!("High priority at launch for {n} game binaries")))
        }
        "power_scheme" => {
            let lock = s.summary().applied_tweaks.iter().any(|t| t == "cstate_lock");
            let guid = power::ensure_scheme(s, id, lock)?;
            Ok(Outcome::Applied(format!("'{}' ready ({})", power::SCHEME_NAME, &guid[..8])))
        }
        "cstate_lock" => {
            power::ensure_scheme(s, "power_scheme", true)?;
            Ok(Outcome::Applied("Idle states disabled while in-match".into()))
        }
        other => Err(AppError::Other(format!("unknown tweak '{other}'"))),
    }
}
