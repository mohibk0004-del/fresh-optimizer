//! In-game settings advisor: reads a game's own settings file and points out
//! settings that add input lag. Read-only: we never edit game files (games
//! overwrite them, and some anti-cheats dislike outside edits).
//!
//! Only settings whose file format we've checked against real files are read.
//! A setting we can't find is simply not mentioned.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    /// What the file says, in plain words.
    pub value: String,
    pub ok: bool,
    pub tip: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Advice {
    pub file: String,
    /// When the game last saved the file (unix seconds): settings changed since aren't seen.
    pub saved: u64,
    pub checks: Vec<Check>,
}

pub struct Context {
    /// Fastest refresh rate of the main display.
    pub max_hz: u32,
    pub nvidia: bool,
}

const VSYNC_TIP: &str = "Turn VSync off in the game's video settings. It waits for the screen before showing each frame, which adds noticeable input lag. (With G-Sync/FreeSync, cap FPS a few below your refresh rate instead.)";
const WINDOWED_TIP: &str = "Switch to Fullscreen (or Borderless/Windowed Fullscreen). Plain windowed mode goes through the desktop compositor and adds lag.";
const REFLEX_TIP: &str = "Turn on NVIDIA Reflex (On, or On + Boost) in the game's video settings. It cuts the queue of frames waiting for your GPU, so clicks show up sooner.";

fn newest(paths: impl IntoIterator<Item = PathBuf>) -> Option<PathBuf> {
    paths.into_iter().filter(|p| p.is_file()).max_by_key(|p| std::fs::metadata(p).and_then(|m| m.modified()).ok())
}

fn subdirs(dir: &Path) -> Vec<PathBuf> {
    std::fs::read_dir(dir).map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect()).unwrap_or_default()
}

fn read_text(p: &Path) -> Option<String> {
    let bytes = std::fs::read(p).ok()?;
    // Some games pad these files with NUL bytes.
    Some(String::from_utf8_lossy(&bytes).replace('\0', ""))
}

/// `"key"  "value"` pairs (Source / Respawn video configs).
fn kv(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter_map(|l| {
            let q: Vec<&str> = l.split('"').collect();
            (q.len() >= 4).then(|| (q[1].to_ascii_lowercase(), q[3].to_string()))
        })
        .collect()
}

/// `key=value` lines (INI files).
fn ini(text: &str) -> HashMap<String, String> {
    text.lines()
        .filter(|l| !l.trim_start().starts_with(';'))
        .filter_map(|l| l.split_once('=').map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string())))
        .collect()
}

fn vsync(on: bool) -> Check {
    Check { name: "VSync".into(), value: if on { "On" } else { "Off" }.into(), ok: !on, tip: on.then(|| VSYNC_TIP.into()) }
}

fn window(mode: &str, windowed: bool) -> Check {
    Check { name: "Display mode".into(), value: mode.into(), ok: !windowed, tip: windowed.then(|| WINDOWED_TIP.into()) }
}

fn reflex(on: bool, ctx: &Context) -> Option<Check> {
    ctx.nvidia.then(|| Check { name: "NVIDIA Reflex".into(), value: if on { "On" } else { "Off" }.into(), ok: on, tip: (!on).then(|| REFLEX_TIP.into()) })
}

fn refresh(game_hz: f64, ctx: &Context) -> Option<Check> {
    if game_hz <= 0.0 || ctx.max_hz == 0 {
        return None;
    }
    let low = game_hz.round() + 1.0 < ctx.max_hz as f64;
    Some(Check {
        name: "Refresh rate".into(),
        value: format!("{} Hz", game_hz.round()),
        ok: !low,
        tip: low.then(|| format!("The game is set to {} Hz but your screen can do {} Hz. Pick {} Hz in its video settings.", game_hz.round(), ctx.max_hz, ctx.max_hz)),
    })
}

fn fps_cap(limit: f64, ctx: &Context) -> Option<Check> {
    if limit <= 0.0 || ctx.max_hz == 0 || limit + 1.0 >= ctx.max_hz as f64 {
        return None;
    }
    Some(Check {
        name: "FPS limit".into(),
        value: format!("{}", limit.round()),
        ok: false,
        tip: Some(format!(
            "FPS is capped at {} on a {} Hz screen. Unless you capped it on purpose (to keep fans quiet or with G-Sync), raise it to at least {}.",
            limit.round(),
            ctx.max_hz,
            ctx.max_hz
        )),
    })
}

fn cs2(ctx: &Context) -> Option<Advice> {
    let root = crate::games::steam_root()?;
    let file = newest(subdirs(&root.join("userdata")).into_iter().map(|u| u.join(r"730\local\cfg\cs2_video.txt")))?;
    let m = kv(&read_text(&file)?);
    let mut checks = Vec::new();
    if let Some(v) = m.get("setting.mat_vsync") {
        checks.push(vsync(v != "0"));
    }
    if let (Some(fs), Some(nb)) = (m.get("setting.fullscreen"), m.get("setting.nowindowborder")) {
        let (label, windowed) = match (fs.as_str(), nb.as_str()) {
            ("1", _) => ("Fullscreen", false),
            (_, "1") => ("Fullscreen windowed", false),
            _ => ("Windowed", true),
        };
        checks.push(window(label, windowed));
    }
    if let (Some(n), Some(d)) = (m.get("setting.refreshrate_numerator"), m.get("setting.refreshrate_denominator")) {
        if let (Ok(n), Ok(d)) = (n.parse::<f64>(), d.parse::<f64>()) {
            if d > 0.0 {
                checks.extend(refresh(n / d, ctx));
            }
        }
    }
    if let Some(v) = m.get("setting.r_low_latency") {
        checks.extend(reflex(v != "0", ctx));
    }
    Some(Advice { file: file.display().to_string(), saved: 0, checks })
}

fn apex(_ctx: &Context) -> Option<Advice> {
    let file = PathBuf::from(std::env::var_os("USERPROFILE")?).join(r"Saved Games\Respawn\Apex\local\videoconfig.txt");
    let m = kv(&read_text(&file)?);
    let mut checks = Vec::new();
    if let Some(v) = m.get("setting.mat_vsync_mode") {
        checks.push(vsync(v != "0"));
    }
    if let (Some(fs), Some(nb)) = (m.get("setting.fullscreen"), m.get("setting.nowindowborder")) {
        let (label, windowed) = match (fs.as_str(), nb.as_str()) {
            ("1", _) => ("Fullscreen", false),
            (_, "1") => ("Borderless window", false),
            _ => ("Windowed", true),
        };
        checks.push(window(label, windowed));
    }
    Some(Advice { file: file.display().to_string(), saved: 0, checks })
}

/// Unreal Engine `FullscreenMode`: 0 fullscreen, 1 windowed fullscreen, 2 windowed.
fn ue_window(m: &HashMap<String, String>) -> Option<Check> {
    let v = m.get("fullscreenmode").or_else(|| m.get("lastconfirmedfullscreenmode"))?;
    Some(match v.as_str() {
        "0" => window("Fullscreen", false),
        "1" => window("Windowed fullscreen", false),
        "2" => window("Windowed", true),
        _ => return None,
    })
}

fn ue_game(file: PathBuf, ctx: &Context) -> Option<Advice> {
    let m = ini(&read_text(&file)?);
    let mut checks = Vec::new();
    if let Some(v) = m.get("busevsync") {
        checks.push(vsync(v.eq_ignore_ascii_case("true")));
    }
    checks.extend(ue_window(&m));
    if let Some(v) = m.get("frameratelimit").and_then(|v| v.parse::<f64>().ok()) {
        checks.extend(fps_cap(v, ctx));
    }
    Some(Advice { file: file.display().to_string(), saved: 0, checks })
}

fn local_appdata() -> Option<PathBuf> {
    std::env::var_os("LOCALAPPDATA").map(PathBuf::from)
}

fn valorant(ctx: &Context) -> Option<Advice> {
    let cfg = local_appdata()?.join(r"VALORANT\Saved\Config");
    let account = newest(subdirs(&cfg).into_iter().map(|d| d.join(r"Windows\GameUserSettings.ini")))?;
    let mut checks = Vec::new();
    // VALORANT keeps VSync and FPS limits in RiotUserSettings.ini, so only the window mode is read here.
    if let Some(c) = ue_window(&ini(&read_text(&account)?)) {
        checks.push(c);
    }
    if let Some(riot) = account.parent().map(|p| p.join("RiotUserSettings.ini")).and_then(|p| read_text(&p)) {
        let m = ini(&riot);
        // VALORANT only writes settings that differ from its defaults.
        if let Some(v) = m.get("earesintsettingname::nvidiareflexlowlatencysetting") {
            checks.extend(reflex(v != "0", ctx));
        }
        if let Some((_, v)) = m.iter().find(|(k, _)| k.starts_with("earesboolsettingname::") && k.contains("vsync")) {
            checks.push(vsync(v.eq_ignore_ascii_case("true")));
        }
    }
    Some(Advice { file: account.display().to_string(), saved: 0, checks })
}

fn r6(ctx: &Context) -> Option<Advice> {
    let dir = PathBuf::from(std::env::var_os("USERPROFILE")?).join(r"Documents\My Games\Rainbow Six - Siege");
    let file = newest(subdirs(&dir).into_iter().map(|d| d.join("GameSettings.ini")))?;
    let m = ini(&read_text(&file)?);
    let mut checks = Vec::new();
    if let Some(v) = m.get("vsync") {
        checks.push(vsync(v != "0"));
    }
    if let Some(v) = m.get("windowmode") {
        checks.push(match v.as_str() {
            "0" => window("Fullscreen", false),
            "2" => window("Borderless", false),
            _ => window("Windowed", true),
        });
    }
    if let Some(v) = m.get("refreshrate").and_then(|v| v.parse::<f64>().ok()) {
        checks.extend(refresh(v, ctx));
    }
    if let Some(v) = m.get("fpslimit").and_then(|v| v.parse::<f64>().ok()) {
        if v >= 30.0 {
            checks.extend(fps_cap(v, ctx));
        }
    }
    if let Some(v) = m.get("nvreflex") {
        checks.extend(reflex(v != "0", ctx));
    }
    Some(Advice { file: file.display().to_string(), saved: 0, checks })
}

/// Advice for every supported game whose settings file exists.
pub fn all(ctx: &Context) -> HashMap<String, Advice> {
    let la = local_appdata();
    let mut out = HashMap::new();
    let mut put = |id: &str, a: Option<Advice>| {
        if let Some(mut a) = a.filter(|a| !a.checks.is_empty()) {
            a.saved = std::fs::metadata(&a.file)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            out.insert(id.to_string(), a);
        }
    };
    put("cs2", cs2(ctx));
    put("apex", apex(ctx));
    put("valorant", valorant(ctx));
    put("r6siege", r6(ctx));
    if let Some(la) = &la {
        put("fortnite", ue_game(la.join(r"FortniteGame\Saved\Config\WindowsClient\GameUserSettings.ini"), ctx));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_source_and_ini() {
        let m = kv("\"video.cfg\"\n{\n\t\"setting.mat_vsync\"\t\t\"1\"\n}");
        assert_eq!(m.get("setting.mat_vsync").map(String::as_str), Some("1"));
        let i = ini(";VSync => 0 disabled\nVSync=0\nWindowMode=1\n");
        assert_eq!(i.get("vsync").map(String::as_str), Some("0"));
        assert_eq!(i.get("windowmode").map(String::as_str), Some("1"));
        let ctx = Context { max_hz: 240, nvidia: true };
        assert!(refresh(239.998, &ctx).unwrap().ok);
        assert!(!refresh(144.0, &ctx).unwrap().ok);
        assert!(fps_cap(0.0, &ctx).is_none());
    }
}
