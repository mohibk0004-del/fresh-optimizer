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
use crate::{live, tcp};

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

    // ---- From SG TCP Optimizer (the parts that still matter on Windows 10/11)
    TweakInfo { id: "tcp_coalescing", name: "Receive Segment Coalescing off", category: Category::Network,
        description: "netsh/NetOffload: RSC and the packet coalescing filter disabled, so incoming packets aren't held back to be merged.",
        default_on: true, caution: Some("Brief NIC reconnect") },
    TweakInfo { id: "tcp_heuristics", name: "Window scaling heuristics off", category: Category::Network,
        description: "netsh int tcp set heuristics disabled: Windows can't quietly shrink the TCP receive window.",
        default_on: true, caution: None },
    TweakInfo { id: "tcp_cubic", name: "CUBIC congestion control", category: Category::Network,
        description: "netsh supplemental template=internet congestionprovider=cubic (Windows 11 default; older builds use CTCP).",
        default_on: true, caution: None },
    TweakInfo { id: "dns_priority", name: "Host resolution priority", category: Category::Network,
        description: "Tcpip\\ServiceProvider: local cache, hosts file and DNS are tried before NetBIOS.",
        default_on: true, caution: None },

    // ---- From Optimizer (performance-relevant only)
    TweakInfo { id: "sys_responsiveness", name: "Less CPU reserved for background", category: Category::System,
        description: "MMCSS SystemResponsiveness=10 (default 20): the share of CPU kept for background tasks while games run.",
        default_on: true, caution: None },
    TweakInfo { id: "telemetry_services", name: "Telemetry services off", category: Category::System,
        description: "DiagTrack and dmwappushservice stopped and disabled (background diagnostics upload).",
        default_on: true, caution: None },
    TweakInfo { id: "menu_delay", name: "No menu delay", category: Category::System,
        description: "MenuShowDelay=0 (default 400 ms): menus open instantly.",
        default_on: true, caution: None },
    TweakInfo { id: "widgets_off", name: "Widgets and news off", category: Category::System,
        description: "Policies AllowNewsAndInterests=0 / EnableFeeds=0: the Widgets board and its background process are turned off.",
        default_on: false, caution: None },
    TweakInfo { id: "background_apps", name: "Stop Store apps in background", category: Category::System,
        description: "Policy LetAppsRunInBackground=2: Microsoft Store apps can't run when you're not using them.",
        default_on: false, caution: Some("Store apps lose live notifications") },
    TweakInfo { id: "sysmain_off", name: "SysMain (Superfetch) off", category: Category::System,
        description: "SysMain service disabled: no background preloading of apps into memory.",
        default_on: false, caution: Some("Apps may open slower") },

    // ---- Input
    TweakInfo { id: "mouse_accel_off", name: "Mouse acceleration off", category: Category::Game,
        description: "Enhance pointer precision off (MouseSpeed=0, thresholds 0): mouse movement maps 1:1 to the cursor.",
        default_on: false, caution: Some("Desktop mouse feel changes") },
    TweakInfo { id: "sticky_keys_off", name: "Sticky Keys shortcut off", category: Category::Game,
        description: "Pressing Shift five times no longer pops up Sticky Keys (Filter Keys / Toggle Keys shortcuts too).",
        default_on: true, caution: None },
];

const MULTIMEDIA: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile";
const IFEO: &str = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options";

/// Sets one TCP knob to `want`, recording the old value first.
/// Returns false when it was already set (nothing recorded or changed).
fn knob(s: &RestoreStore, id: &str, k: tcp::Knob, want: &str) -> AppResult<bool> {
    let current = tcp::read(k)?;
    if current == want {
        return Ok(false);
    }
    s.record(id, Entry::Tcp { knob: k, prior: current })?;
    tcp::write(k, want)?;
    Ok(true)
}

/// Disables services via their registry Start value (tracked for Undo) and
/// stops them now. Undo restores the start type; they start again on reboot.
fn disable_services(s: &RestoreStore, id: &str, names: &[&str]) -> AppResult<usize> {
    let mut changed = 0;
    for name in names {
        let path = format!(r"SYSTEM\CurrentControlSet\Services\{name}");
        match registry::read_dword(Hive::LocalMachine, &path, "Start") {
            None => continue,  // service not installed on this edition
            Some(4) => continue, // already disabled
            Some(_) => {}
        }
        registry::set_dword_tracked(s, id, Hive::LocalMachine, &path, "Start", 4)?;
        let _ = crate::util::run_hidden("sc", &["stop", name]);
        changed += 1;
    }
    Ok(changed)
}

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
        "tcp_coalescing" => {
            let rsc = knob(s, id, tcp::Knob::Rsc, "disabled")?;
            let pc = knob(s, id, tcp::Knob::PacketCoalescing, "disabled")?;
            if !rsc && !pc {
                return Ok(Outcome::Skipped("Already off".into()));
            }
            Ok(Outcome::AppliedNic("Incoming packets are no longer held back to be merged".into()))
        }
        "tcp_heuristics" => Ok(if knob(s, id, tcp::Knob::Heuristics, "disabled")? {
            Outcome::Applied("Heuristics disabled".into())
        } else {
            Outcome::Skipped("Already disabled".into())
        }),
        "tcp_cubic" => Ok(if knob(s, id, tcp::Knob::Congestion, "cubic")? {
            Outcome::Applied("Congestion control set to CUBIC".into())
        } else {
            Outcome::Skipped("Already using CUBIC".into())
        }),
        "dns_priority" => {
            let p = r"SYSTEM\CurrentControlSet\Services\Tcpip\ServiceProvider";
            let want = [("LocalPriority", 4u32), ("HostsPriority", 5), ("DnsPriority", 6), ("NetbtPriority", 7)];
            if want.iter().all(|(n, v)| registry::read_dword(Hive::LocalMachine, p, n) == Some(*v)) {
                return Ok(Outcome::Skipped("Already in the best order".into()));
            }
            for (n, v) in want {
                registry::set_dword_tracked(s, id, Hive::LocalMachine, p, n, v)?;
            }
            Ok(Outcome::Applied("Applies after a restart".into()))
        }
        "sys_responsiveness" => {
            if registry::read_dword(Hive::LocalMachine, MULTIMEDIA, "SystemResponsiveness") == Some(10) {
                return Ok(Outcome::Skipped("Already 10%".into()));
            }
            registry::set_dword_tracked(s, id, Hive::LocalMachine, MULTIMEDIA, "SystemResponsiveness", 10)?;
            Ok(Outcome::Applied("Background reserve 20% -> 10%".into()))
        }
        "telemetry_services" => {
            let changed = disable_services(s, id, &["DiagTrack", "dmwappushservice"])?;
            Ok(if changed == 0 { Outcome::Skipped("Already off".into()) } else { Outcome::Applied(format!("{changed} service(s) stopped and disabled")) })
        }
        "sysmain_off" => {
            let changed = disable_services(s, id, &["SysMain"])?;
            Ok(if changed == 0 { Outcome::Skipped("Already off".into()) } else { Outcome::Applied("SysMain stopped and disabled".into()) })
        }
        "menu_delay" => {
            let p = r"Control Panel\Desktop";
            if registry::read_string(Hive::CurrentUser, p, "MenuShowDelay").as_deref() == Some("0") {
                return Ok(Outcome::Skipped("Already instant".into()));
            }
            registry::set_string_tracked(s, id, Hive::CurrentUser, p, "MenuShowDelay", "0")?;
            live::refresh();
            Ok(Outcome::Applied("Menus open instantly".into()))
        }
        "widgets_off" => {
            registry::set_dword_tracked(s, id, Hive::LocalMachine, r"SOFTWARE\Policies\Microsoft\Dsh", "AllowNewsAndInterests", 0)?;
            registry::set_dword_tracked(s, id, Hive::LocalMachine, r"SOFTWARE\Policies\Microsoft\Windows\Windows Feeds", "EnableFeeds", 0)?;
            Ok(Outcome::Applied("Fully applies after you sign out".into()))
        }
        "background_apps" => {
            registry::set_dword_tracked(s, id, Hive::LocalMachine, r"SOFTWARE\Policies\Microsoft\Windows\AppPrivacy", "LetAppsRunInBackground", 2)?;
            Ok(Outcome::Applied("Store apps only run while open".into()))
        }
        "mouse_accel_off" => {
            let p = r"Control Panel\Mouse";
            let off = ["MouseSpeed", "MouseThreshold1", "MouseThreshold2"].iter().all(|n| registry::read_string(Hive::CurrentUser, p, n).as_deref() == Some("0"));
            if off {
                return Ok(Outcome::Skipped("Already off".into()));
            }
            for n in ["MouseSpeed", "MouseThreshold1", "MouseThreshold2"] {
                registry::set_string_tracked(s, id, Hive::CurrentUser, p, n, "0")?;
            }
            live::refresh();
            Ok(Outcome::Applied("Applied now".into()))
        }
        "sticky_keys_off" => {
            let base = r"Control Panel\Accessibility";
            registry::set_string_tracked(s, id, Hive::CurrentUser, &format!(r"{base}\StickyKeys"), "Flags", "506")?;
            registry::set_string_tracked(s, id, Hive::CurrentUser, &format!(r"{base}\Keyboard Response"), "Flags", "122")?;
            registry::set_string_tracked(s, id, Hive::CurrentUser, &format!(r"{base}\ToggleKeys"), "Flags", "58")?;
            live::refresh();
            Ok(Outcome::Applied("Sticky Keys now; Filter and Toggle Keys after you sign out".into()))
        }
        other => Err(AppError::Other(format!("unknown tweak '{other}'"))),
    }
}
