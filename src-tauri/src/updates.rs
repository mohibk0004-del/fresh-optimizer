//! "Check for updates" against GitHub Releases, plus launch-at-startup.
//! Network calls go through PowerShell (no extra HTTP crates), and only to
//! this project's own GitHub release URLs.

use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::util::{self, ps_quote};

pub const REPO: &str = "mohibk0004-del/fresh-optimizer";
pub const REPO_URL: &str = "https://github.com/mohibk0004-del/fresh-optimizer";
const TASK_NAME: &str = "FreshOptimizer";
const DETACHED_PROCESS: u32 = 0x0000_0008;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub available: bool,
    pub notes: String,
    pub published_at: String,
    pub page_url: String,
    /// Installer download (None if the release has no setup .exe attached).
    pub download_url: Option<String>,
    pub size_bytes: u64,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    published_at: String,
    html_url: String,
    #[serde(default)]
    assets: Vec<GhAsset>,
}

fn parse_version(v: &str) -> Vec<u64> {
    v.trim_start_matches(['v', 'V']).split(['.', '-']).take(3).map(|p| p.parse().unwrap_or(0)).collect()
}

fn newer(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

pub fn check() -> AppResult<UpdateInfo> {
    let current = env!("CARGO_PKG_VERSION").to_string();
    let url = format!("https://api.github.com/repos/{REPO}/releases/latest");
    let script = format!(
        "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;\
         (Invoke-WebRequest -UseBasicParsing -TimeoutSec 15 -Headers @{{'User-Agent'='FreshOptimizer'}} -Uri {}).Content",
        ps_quote(&url)
    );
    let out = util::powershell(&script).map_err(|_| AppError::Other("Couldn't reach GitHub. Check your internet connection.".into()))?;
    let rel: GhRelease = serde_json::from_str(out.trim()).map_err(|_| AppError::Other("GitHub sent an unexpected reply.".into()))?;
    let asset = rel.assets.iter().find(|a| {
        let n = a.name.to_ascii_lowercase();
        n.ends_with(".exe") && n.contains("setup")
    });
    Ok(UpdateInfo {
        available: newer(&rel.tag_name, &current),
        latest: rel.tag_name.trim_start_matches('v').to_string(),
        current,
        notes: rel.body,
        published_at: rel.published_at,
        page_url: rel.html_url,
        download_url: asset.map(|a| a.browser_download_url.clone()),
        size_bytes: asset.map(|a| a.size).unwrap_or(0),
    })
}

/// Downloads the installer from this repo's releases and starts it.
/// The caller exits the app right after so setup can replace the binary.
pub fn download_and_run(url: &str) -> AppResult<()> {
    let allowed = format!("https://github.com/{REPO}/releases/download/");
    if !url.starts_with(&allowed) || !url.to_ascii_lowercase().ends_with(".exe") {
        return Err(AppError::Other("Refusing to download from an unexpected address.".into()));
    }
    let dest = std::env::temp_dir().join("FreshOptimizer-Setup-update.exe");
    let script = format!(
        "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;\
         $ProgressPreference='SilentlyContinue';\
         Invoke-WebRequest -UseBasicParsing -TimeoutSec 300 -Headers @{{'User-Agent'='FreshOptimizer'}} -Uri {} -OutFile {}",
        ps_quote(url),
        ps_quote(&dest.display().to_string())
    );
    util::powershell(&script).map_err(|_| AppError::Other("Download failed. Try again, or grab it from GitHub.".into()))?;
    let len = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    if len < 1_000_000 {
        return Err(AppError::Other("The download looks incomplete. Try again.".into()));
    }
    std::process::Command::new(&dest)
        .creation_flags(DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
        .map_err(|e| AppError::Command(format!("couldn't start installer: {e}")))
}

/// Opens one of this project's own pages in the default browser.
pub fn open_project_url(url: &str) -> AppResult<()> {
    if !url.starts_with(REPO_URL) {
        return Err(AppError::Other("That link isn't allowed".into()));
    }
    std::process::Command::new("explorer.exe").arg(url).spawn().map(|_| ()).map_err(AppError::from)
}

// ------------------------------------------------------------ launch at startup

/// The app requires admin, so a Run-key entry would trigger a UAC prompt at
/// every sign-in. A scheduled task with "highest privileges" starts it silently.
pub fn startup_enabled() -> bool {
    util::run_hidden("schtasks", &["/Query", "/TN", TASK_NAME]).is_ok()
}

pub fn set_startup(enabled: bool) -> AppResult<()> {
    if enabled {
        let exe = std::env::current_exe()?;
        let tr = format!("\"{}\" --minimized", exe.display());
        util::run_hidden("schtasks", &["/Create", "/TN", TASK_NAME, "/TR", &tr, "/SC", "ONLOGON", "/RL", "HIGHEST", "/F"])?;
    } else if startup_enabled() {
        util::run_hidden("schtasks", &["/Delete", "/TN", TASK_NAME, "/F"])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn compares_versions() {
        assert!(newer("v0.3.0", "0.2.0"));
        assert!(newer("0.2.10", "0.2.9"));
        assert!(!newer("v0.2.0", "0.2.0"));
        assert!(!newer("0.1.9", "0.2.0"));
    }
}
