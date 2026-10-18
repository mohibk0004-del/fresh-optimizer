//! Read-only PC checks: Wi-Fi link, graphics driver age, overlays/recorders, and
//! a one-click health check that turns everything we can measure into a short,
//! prioritised to-do list. Nothing here changes a setting.

use serde::Serialize;
use windows_sys::Win32::Foundation::HANDLE;
use windows_sys::Win32::NetworkManagement::WiFi::{
    wlan_interface_state_connected, wlan_intf_opcode_channel_number, wlan_intf_opcode_current_connection, WlanCloseHandle, WlanEnumInterfaces,
    WlanFreeMemory, WlanGetNetworkBssList, WlanOpenHandle, WlanQueryInterface, WLAN_BSS_ENTRY, WLAN_BSS_LIST, WLAN_CONNECTION_ATTRIBUTES,
    WLAN_INTERFACE_INFO, WLAN_INTERFACE_INFO_LIST,
};

use crate::hardware::HardwareProfile;

// ---------------------------------------------------------------- Wi-Fi

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiInfo {
    pub ssid: String,
    /// 0..100 as reported by Windows.
    pub signal_pct: u32,
    /// "2.4 GHz" / "5 GHz" / "6 GHz", when known.
    pub band: Option<String>,
    pub channel: Option<u32>,
    /// e.g. "Wi-Fi 6 (802.11ax)".
    pub standard: String,
    pub link_mbps: u32,
}

/// Band from the centre frequency (kHz) the access point reports.
pub fn band_from_khz(khz: u32) -> Option<&'static str> {
    match khz / 1000 {
        2400..=2500 => Some("2.4 GHz"),
        5150..=5900 => Some("5 GHz"),
        5925..=7125 => Some("6 GHz"),
        _ => None,
    }
}

/// Fallback when the frequency isn't available. 6 GHz channels overlap these
/// numbers, so this is only used for 802.11n/ac links that can't be on 6 GHz.
pub fn band_from_channel(ch: u32) -> Option<&'static str> {
    match ch {
        1..=14 => Some("2.4 GHz"),
        32..=177 => Some("5 GHz"),
        _ => None,
    }
}

fn standard(phy: i32) -> &'static str {
    // DOT11_PHY_TYPE values.
    match phy {
        7 => "Wi-Fi 4 (802.11n)",
        8 => "Wi-Fi 5 (802.11ac)",
        10 => "Wi-Fi 6 (802.11ax)",
        11 => "Wi-Fi 7 (802.11be)",
        4 => "802.11a",
        5 => "802.11g",
        6 => "802.11b",
        _ => "Wi-Fi",
    }
}

/// The connected Wi-Fi link, or `None` when not on Wi-Fi.
pub fn wifi() -> Option<WifiInfo> {
    // SAFETY: WLAN API handles and buffers are checked and released with
    // WlanFreeMemory / WlanCloseHandle; reads stay inside reported counts.
    unsafe {
        let mut ver = 0u32;
        let mut h: HANDLE = std::ptr::null_mut();
        if WlanOpenHandle(2, std::ptr::null(), &mut ver, &mut h) != 0 {
            return None;
        }
        let mut list: *mut WLAN_INTERFACE_INFO_LIST = std::ptr::null_mut();
        let mut out = None;
        if WlanEnumInterfaces(h, std::ptr::null(), &mut list) == 0 && !list.is_null() {
            let n = (*list).dwNumberOfItems as usize;
            let items = std::slice::from_raw_parts((*list).InterfaceInfo.as_ptr() as *const WLAN_INTERFACE_INFO, n);
            for it in items.iter().filter(|i| i.isState == wlan_interface_state_connected) {
                let mut size = 0u32;
                let mut data: *mut core::ffi::c_void = std::ptr::null_mut();
                if WlanQueryInterface(h, &it.InterfaceGuid, wlan_intf_opcode_current_connection, std::ptr::null(), &mut size, &mut data, std::ptr::null_mut()) != 0 {
                    continue;
                }
                let conn = &*(data as *const WLAN_CONNECTION_ATTRIBUTES);
                let a = &conn.wlanAssociationAttributes;
                let ssid_len = (a.dot11Ssid.uSSIDLength as usize).min(32);
                let ssid = String::from_utf8_lossy(&a.dot11Ssid.ucSSID[..ssid_len]).into_owned();

                let mut ch_data: *mut core::ffi::c_void = std::ptr::null_mut();
                let channel = if WlanQueryInterface(h, &it.InterfaceGuid, wlan_intf_opcode_channel_number, std::ptr::null(), &mut size, &mut ch_data, std::ptr::null_mut()) == 0 {
                    let c = *(ch_data as *const u32);
                    WlanFreeMemory(ch_data);
                    Some(c)
                } else {
                    None
                };
                // Exact band from the access point's centre frequency.
                let mut bss: *mut WLAN_BSS_LIST = std::ptr::null_mut();
                let mut band = None;
                if WlanGetNetworkBssList(h, &it.InterfaceGuid, &a.dot11Ssid, a.dot11BssType, 1, std::ptr::null(), &mut bss) == 0 && !bss.is_null() {
                    let m = (*bss).dwNumberOfItems as usize;
                    let entries = std::slice::from_raw_parts((*bss).wlanBssEntries.as_ptr() as *const WLAN_BSS_ENTRY, m);
                    band = entries.iter().find(|e| e.dot11Bssid == a.dot11Bssid).and_then(|e| band_from_khz(e.ulChCenterFrequency));
                    WlanFreeMemory(bss as *const _);
                }
                let phy = a.dot11PhyType;
                if band.is_none() && phy != 10 && phy != 11 {
                    band = channel.and_then(band_from_channel);
                }
                out = Some(WifiInfo {
                    ssid,
                    signal_pct: a.wlanSignalQuality,
                    band: band.map(String::from),
                    channel,
                    standard: standard(phy).into(),
                    link_mbps: a.ulRxRate / 1000,
                });
                WlanFreeMemory(data);
                break;
            }
            WlanFreeMemory(list as *const _);
        }
        WlanCloseHandle(h, std::ptr::null());
        out
    }
}

// ---------------------------------------------------------------- driver age

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    pub gpu: String,
    pub vendor: String,
    /// Windows' version string, e.g. 32.0.16.1692.
    pub version: String,
    /// The number the vendor uses (NVIDIA: 616.92), when known.
    pub retail: Option<String>,
    /// YYYY-MM-DD from the driver package.
    pub date: Option<String>,
    pub age_days: Option<u64>,
    pub download_url: &'static str,
}

/// NVIDIA's retail number is the last five digits of Windows' version.
pub fn nvidia_retail(version: &str) -> Option<String> {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 4 {
        return None;
    }
    let digits = format!("{}{:0>4}", parts[2], parts[3]);
    let last5 = &digits[digits.len().checked_sub(5)?..];
    Some(format!("{}.{}", &last5[..3], &last5[3..]))
}

/// "M-D-YYYY" (registry DriverDate) to (y, m, d).
fn parse_driver_date(s: &str) -> Option<(i64, u32, u32)> {
    let p: Vec<&str> = s.trim().split(['-', '/']).collect();
    if p.len() != 3 {
        return None;
    }
    Some((p[2].parse().ok()?, p[0].parse().ok()?, p[1].parse().ok()?))
}

/// Days since 1970-01-01 (Howard Hinnant's days_from_civil).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

pub fn driver(profile: &HardwareProfile) -> Option<DriverInfo> {
    let g = profile.gpus.iter().find(|g| !g.name.to_ascii_lowercase().contains("microsoft"))?;
    let lower = g.name.to_ascii_lowercase();
    let (vendor, url) = if lower.contains("nvidia") {
        ("NVIDIA", "https://www.nvidia.com/en-us/drivers/")
    } else if lower.contains("amd") || lower.contains("radeon") {
        ("AMD", "https://www.amd.com/en/support/download/drivers.html")
    } else if lower.contains("intel") {
        ("Intel", "https://www.intel.com/content/www/us/en/support/detect.html")
    } else {
        ("", "")
    };
    let date = parse_driver_date(&g.driver_date);
    let today = (crate::util::now_unix() / 86_400) as i64;
    Some(DriverInfo {
        gpu: g.name.clone(),
        vendor: vendor.into(),
        version: g.driver_version.clone(),
        retail: if vendor == "NVIDIA" { nvidia_retail(&g.driver_version) } else { None },
        date: date.map(|(y, m, d)| format!("{y:04}-{m:02}-{d:02}")),
        age_days: date.map(|(y, m, d)| (today - days_from_civil(y, m, d)).max(0) as u64),
        download_url: url,
    })
}

// ---------------------------------------------------------------- overlays

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Overlay {
    pub name: String,
    pub note: String,
}

/// (process name, display name, what to tell the user). Only process names are
/// read; we never claim a setting we can't read.
const OVERLAYS: &[(&str, &str, &str)] = &[
    ("Discord.exe", "Discord", "Its in-game overlay can cost a little FPS. Turn it off in Discord: User Settings > Game Overlay."),
    ("NVIDIA Overlay.exe", "NVIDIA overlay", "Instant Replay and the overlay record in the background. Turn off what you don't use in the NVIDIA App (Alt+Z)."),
    ("NVIDIA Share.exe", "NVIDIA overlay", "Instant Replay and the overlay record in the background. Turn off what you don't use in GeForce Experience (Alt+Z)."),
    ("RadeonSoftware.exe", "AMD Software", "If Instant Replay is on, it records in the background. Check AMD Software > Record & Stream."),
    ("GameBar.exe", "Xbox Game Bar", "Open now. Background recording is checked separately on the My PC page."),
    ("obs64.exe", "OBS Studio", "Recording or streaming uses GPU and CPU time. Close it when you're not using it."),
    ("medal.exe", "Medal", "Clips record in the background, which costs some performance."),
    ("Overwolf.exe", "Overwolf", "Overwolf apps add overlays and background work while you play."),
    ("RTSS.exe", "RivaTuner (RTSS)", "Its on-screen display hooks into games. Fine for most players; turn it off if you don't watch it."),
    ("MSIAfterburner.exe", "MSI Afterburner", "Monitoring is light, but its on-screen display uses RivaTuner hooks."),
];

pub fn overlays() -> Vec<Overlay> {
    let procs = crate::games::list_processes();
    let mut out: Vec<Overlay> = Vec::new();
    for (exe, name, note) in OVERLAYS {
        if procs.iter().any(|p| p.exe.eq_ignore_ascii_case(exe)) && !out.iter().any(|o| o.name == *name) {
            out.push(Overlay { name: (*name).into(), note: (*note).into() });
        }
    }
    out
}

// ---------------------------------------------------------------- health check

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthItem {
    pub id: String,
    /// "fix", "worth" or "fine".
    pub level: &'static str,
    pub title: String,
    pub detail: String,
    /// Page to open ("pc", "games", "network", "tweaks"), or an ms-settings: URI.
    pub go: Option<String>,
}

fn item(id: &str, level: &'static str, title: impl Into<String>, detail: impl Into<String>, go: Option<&str>) -> HealthItem {
    HealthItem { id: id.into(), level, title: title.into(), detail: detail.into(), go: go.map(String::from) }
}

pub fn health(profile: Option<&HardwareProfile>, applied_tweaks: usize, nvidia: bool) -> Vec<HealthItem> {
    let mut out = Vec::new();

    for d in crate::display::list() {
        if d.current_hz < d.max_hz {
            out.push(item("refresh", "fix", format!("{} runs at {} Hz, not {} Hz", d.monitor, d.current_hz, d.max_hz), "You're seeing fewer frames than your screen can show. Fix it in one click.", Some("pc")));
        } else {
            out.push(item("refresh", "fine", format!("{} at its fastest refresh rate ({} Hz)", d.monitor, d.current_hz), "", None));
        }
    }

    if let Some(p) = profile {
        let (cfg, rated) = (p.ram.configured_mhz, p.ram.rated_mhz);
        if cfg > 0 && rated > 0 && cfg < rated {
            out.push(item(
                "xmp",
                "worth",
                format!("Memory runs below its rated speed ({cfg} of {rated} MT/s)"),
                "Turning on XMP/EXPO in your BIOS is often a free FPS boost. FreshOptimizer can't change BIOS settings.",
                Some("pc"),
            ));
        } else if p.xmp_likely {
            out.push(item("xmp", "fine", format!("Memory runs at {cfg} MT/s with XMP/EXPO"), "", None));
        } else if cfg > 0 {
            // Windows only knows the standard (JEDEC) speed, not the XMP speed on the box.
            out.push(item("xmp", "fine", format!("Memory runs at {cfg} MT/s"), "If your memory's label says it's faster, turn on XMP/EXPO in your BIOS.", None));
        }
        if let Some(d) = driver(p) {
            match d.age_days {
                Some(days) if days > 180 => out.push(item(
                    "driver",
                    "worth",
                    format!("Graphics driver is {} months old", days / 30),
                    "New drivers often include fixes and optimisations for recent games. Get it from the official site.",
                    Some("pc"),
                )),
                Some(_) => out.push(item("driver", "fine", "Graphics driver is recent", "", None)),
                None => {}
            }
        }
        if p.nic.as_ref().is_some_and(|n| n.media.contains("802.11")) || wifi().is_some() {
            match wifi() {
                Some(w) if w.band.as_deref() == Some("2.4 GHz") => {
                    out.push(item("wifi", "fix", "You're on 2.4 GHz Wi-Fi", "It's slower and busier. Connect to your router's 5 GHz network, or use a cable for the steadiest ping.", Some("pc")))
                }
                Some(w) if w.signal_pct < 60 => out.push(item(
                    "wifi",
                    "fix",
                    format!("Weak Wi-Fi signal ({}%)", w.signal_pct),
                    "Weak signal causes ping spikes and lost packets. Move closer to the router or use a cable.",
                    Some("pc"),
                )),
                Some(_) => out.push(item("wifi", "worth", "You're on Wi-Fi", "Wi-Fi works, but a cable always gives steadier ping in online games.", Some("pc"))),
                None => {}
            }
        } else {
            out.push(item("wifi", "fine", "Wired connection", "", None));
        }
    }

    let live = crate::hardware::live_status();
    if live.game_dvr_enabled {
        out.push(item("dvr", "worth", "Background recording is on", "Xbox Game Bar records the last minutes of gameplay all the time. Boost turns this off.", Some("tweaks")));
    }
    if !live.game_mode_enabled {
        out.push(item("gamemode", "worth", "Windows Game Mode is off", "Game Mode keeps Windows Update and background tasks quieter while you play.", Some("ms-settings:gaming-gamemode")));
    }
    if let Ok(scheme) = crate::power::active_scheme() {
        if scheme.eq_ignore_ascii_case("a1841308-3541-4fab-bc81-f71556f20b4a") {
            out.push(item("power", "fix", "Power saver plan is active", "It caps your CPU speed. Switch to Balanced or let Boost set up the full-power plan.", Some("ms-settings:powersleep")));
        }
    }
    if applied_tweaks == 0 {
        out.push(item("boost", "worth", "Boost hasn't been run yet", "One click applies the recommended tweaks. Everything can be undone.", Some("tweaks")));
    } else {
        out.push(item("boost", "fine", format!("Boost is applied ({applied_tweaks} tweaks)"), "", None));
    }

    let on = crate::startup::list().into_iter().filter(|i| i.enabled).count();
    if on > 8 {
        out.push(item("startup", "worth", format!("{on} apps start with Windows"), "Fewer startup apps means a faster boot and less running in the background.", Some("pc")));
    }

    for o in overlays() {
        out.push(item("overlay", "worth", format!("{} is running", o.name), o.note, None));
    }

    let installed: Vec<String> = crate::games::discover().into_iter().filter(|g| g.installed).map(|g| g.id).collect();
    let max_hz = crate::display::list().iter().find(|d| d.primary).map(|d| d.max_hz).unwrap_or(0);
    for (id, a) in crate::advisor::all(&crate::advisor::Context { max_hz, nvidia }) {
        if !installed.contains(&id) {
            continue;
        }
        let tips: Vec<&str> = a.checks.iter().filter(|c| !c.ok).map(|c| c.name.as_str()).collect();
        let name = crate::games::def(&id).map(|d| d.name).unwrap_or("A game");
        if tips.is_empty() {
            out.push(item("game", "fine", format!("{name}: in-game settings look good"), "", None));
        } else {
            out.push(item("game", "fix", format!("{name}: {} adding lag", tips.join(", ")), "See the tips on its card on the Games page.", Some("games")));
        }
    }

    let rank = |l: &str| match l {
        "fix" => 0,
        "worth" => 1,
        _ => 2,
    };
    out.sort_by_key(|i| rank(i.level));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_versions_bands_and_dates() {
        assert_eq!(nvidia_retail("32.0.16.1692").as_deref(), Some("616.92"));
        assert_eq!(nvidia_retail("31.0.15.5186").as_deref(), Some("551.86"));
        assert_eq!(nvidia_retail("1.2"), None);
        assert_eq!(band_from_khz(2_437_000), Some("2.4 GHz"));
        assert_eq!(band_from_khz(5_180_000), Some("5 GHz"));
        assert_eq!(band_from_khz(5_975_000), Some("6 GHz"));
        assert_eq!(band_from_channel(6), Some("2.4 GHz"));
        assert_eq!(band_from_channel(149), Some("5 GHz"));
        assert_eq!(parse_driver_date("9-4-2026"), Some((2026, 9, 4)));
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2026, 10, 18), 20_744);
    }
}
