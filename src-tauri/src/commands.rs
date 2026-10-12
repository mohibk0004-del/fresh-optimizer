//! Tauri IPC surface. Blocking work (PowerShell, ICMP, netsh) always runs on the
//! blocking pool so the UI thread never stalls.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::dns::{self, DnsStatus};
use crate::engine::{Engine, EngineStatus};
use crate::error::{AppError, AppResult};
use crate::games::{self, GameInfo};
use crate::hardware::{self, HardwareProfile, LiveStatus};
use crate::latency::{self, LatencyReport};
use crate::network::{self, NicProperty};
use crate::ping::{self, PingStats, PingTarget};
use crate::prefs::{GamePrefs, PrefsStore};
use crate::startup::{self, StartupItem};
use crate::restore::{Entry, RestoreStore, RestoreSummary, RollbackReport};
use crate::tweaks::{self, TweakInfo, TweakResult};
use crate::updates::{self, UpdateInfo};

pub struct AppState {
    pub store: Arc<RestoreStore>,
    pub engine: Engine,
    pub prefs: Arc<PrefsStore>,
    pub profile: Mutex<Option<HardwareProfile>>,
    /// Adapter whose advanced properties changed and still needs one restart.
    pub nic_pending_restart: Mutex<Option<String>>,
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> AppResult<T> + Send + 'static) -> AppResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AppError::Other(format!("worker failed: {e}")))?
}

fn cached_profile(state: &AppState) -> AppResult<HardwareProfile> {
    let mut guard = state.profile.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(p) = guard.as_ref() {
        return Ok(p.clone());
    }
    let p = hardware::profile()?;
    *guard = Some(p.clone());
    Ok(p)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemSnapshot {
    pub profile: HardwareProfile,
    pub live: LiveStatus,
    pub is_admin: bool,
}

#[tauri::command]
pub async fn get_system_info(app: AppHandle, refresh: Option<bool>) -> AppResult<SystemSnapshot> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        if refresh.unwrap_or(false) {
            *state.profile.lock().unwrap_or_else(|p| p.into_inner()) = None;
        }
        Ok(SystemSnapshot { profile: cached_profile(&state)?, live: hardware::live_status(), is_admin: is_elevated() })
    })
    .await
}

#[tauri::command]
pub async fn measure_latency() -> AppResult<LatencyReport> {
    blocking(|| latency::measure(300)).await
}

#[tauri::command]
pub async fn get_games() -> AppResult<Vec<GameInfo>> {
    blocking(|| Ok(games::discover())).await
}

#[tauri::command]
pub fn list_tweaks() -> Vec<TweakInfo> {
    tweaks::CATALOG.to_vec()
}

#[tauri::command]
pub async fn apply_tweak(app: AppHandle, id: String) -> AppResult<TweakResult> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        let profile = cached_profile(&state)?;
        let ctx = tweaks::Ctx { store: &state.store, nic: profile.nic.as_ref() };
        let result = tweaks::apply(&id, &ctx);
        if result.needs_nic_restart {
            if let Some(nic) = &profile.nic {
                *state.nic_pending_restart.lock().unwrap_or_else(|p| p.into_inner()) = Some(nic.name.clone());
            }
        }
        Ok(result)
    })
    .await
}

/// Called once after a boost sequence: restarts the NIC a single time if any
/// advanced property changed, instead of once per property.
#[tauri::command]
pub async fn finalize_boost(app: AppHandle) -> AppResult<Option<String>> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        let pending = state.nic_pending_restart.lock().unwrap_or_else(|p| p.into_inner()).take();
        match pending {
            Some(adapter) => {
                network::restart_adapter(&adapter)?;
                Ok(Some(adapter))
            }
            None => Ok(None),
        }
    })
    .await
}

#[tauri::command]
pub fn restore_summary(state: State<'_, AppState>) -> RestoreSummary {
    state.store.summary()
}

#[tauri::command]
pub async fn rollback(app: AppHandle) -> AppResult<RollbackReport> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        state.engine.stop();
        *state.nic_pending_restart.lock().unwrap_or_else(|p| p.into_inner()) = None;
        Ok(state.store.rollback())
    })
    .await
}

#[tauri::command]
pub async fn engine_start(app: AppHandle) -> AppResult<EngineStatus> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        let profile = cached_profile(&state)?;
        let mask = profile.topology.hybrid.then_some(profile.topology.p_core_mask);
        state.engine.start(app.clone(), state.store.clone(), state.prefs.clone(), mask);
        Ok(state.engine.status())
    })
    .await
}

#[tauri::command]
pub async fn engine_stop(app: AppHandle) -> AppResult<EngineStatus> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        state.engine.stop();
        Ok(state.engine.status())
    })
    .await
}

#[tauri::command]
pub fn engine_status(state: State<'_, AppState>) -> EngineStatus {
    state.engine.status()
}

#[tauri::command]
pub async fn ping_probe(targets: Option<Vec<PingTarget>>, samples: Option<u32>) -> AppResult<Vec<PingStats>> {
    blocking(move || Ok(ping::probe(targets.unwrap_or_else(ping::default_targets), samples.unwrap_or(20)))).await
}

#[tauri::command]
pub async fn ping_once(host: Option<String>) -> AppResult<Option<f64>> {
    blocking(move || Ok(ping::once(host.as_deref().unwrap_or("1.1.1.1")))).await
}

#[tauri::command]
pub async fn nic_properties(app: AppHandle) -> AppResult<Vec<NicProperty>> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        match cached_profile(&state)?.nic {
            Some(nic) => network::read_properties(&nic.name).or_else(|_| Ok(Vec::new())),
            None => Ok(Vec::new()),
        }
    })
    .await
}

#[tauri::command]
pub async fn flush_dns() -> AppResult<String> {
    blocking(network::flush_dns).await
}

#[tauri::command]
pub async fn reset_winsock() -> AppResult<String> {
    blocking(network::reset_winsock).await
}

// ---------------------------------------------------------------- games

#[tauri::command]
pub fn get_game_prefs(state: State<'_, AppState>) -> HashMap<String, GamePrefs> {
    let ids: Vec<&str> = games::GAMES.iter().map(|g| g.id).collect();
    state.prefs.all(&ids)
}

#[tauri::command]
pub fn set_game_prefs(state: State<'_, AppState>, id: String, prefs: GamePrefs) -> AppResult<()> {
    if !games::GAMES.iter().any(|g| g.id == id) {
        return Err(AppError::Other(format!("unknown game '{id}'")));
    }
    state.prefs.set(&id, prefs).map_err(AppError::from)
}

#[tauri::command]
pub async fn launch_game(id: String) -> AppResult<String> {
    blocking(move || games::launch(&id)).await
}

#[tauri::command]
pub async fn open_game_folder(id: String) -> AppResult<()> {
    blocking(move || games::open_folder(&id)).await
}

// ---------------------------------------------------------------- network

/// Changes one NIC advanced property (recorded for Undo) and restarts the adapter.
#[tauri::command]
pub async fn set_nic_setting(app: AppHandle, keyword: String, value: String) -> AppResult<Vec<NicProperty>> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        let nic = cached_profile(&state)?.nic.ok_or_else(|| AppError::Unsupported("No connected network adapter".into()))?;
        if !network::WATCHED_KEYWORDS.iter().any(|k| k.eq_ignore_ascii_case(&keyword)) {
            return Err(AppError::Other(format!("'{keyword}' is not a setting FreshOptimizer manages")));
        }
        let props = network::read_properties(&nic.name)?;
        let prop = props
            .iter()
            .find(|p| p.keyword.eq_ignore_ascii_case(&keyword))
            .ok_or_else(|| AppError::Unsupported("Your network card doesn't have this setting".into()))?;
        if !prop.valid_values.is_empty() && !prop.valid_values.contains(&value) {
            return Err(AppError::Unsupported(format!("Your network card doesn't accept '{value}' here")));
        }
        state.store.record("nic_manual", Entry::NicProperty { adapter: nic.name.clone(), keyword: prop.keyword.clone(), prior: prop.value.clone() })?;
        network::set_nic_property(&nic.name, &prop.keyword, &value)?;
        network::restart_adapter(&nic.name)?;
        state.store.mark_applied("nic_manual");
        network::read_properties(&nic.name)
    })
    .await
}

#[tauri::command]
pub async fn restart_adapter(app: AppHandle) -> AppResult<String> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        let nic = cached_profile(&state)?.nic.ok_or_else(|| AppError::Unsupported("No connected network adapter".into()))?;
        network::restart_adapter(&nic.name)?;
        Ok(nic.name)
    })
    .await
}

#[tauri::command]
pub async fn dns_status(app: AppHandle, measure: Option<bool>) -> AppResult<DnsStatus> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        let nic = cached_profile(&state)?.nic;
        Ok(dns::status(nic.as_ref(), measure.unwrap_or(false)))
    })
    .await
}

#[tauri::command]
pub async fn set_dns(app: AppHandle, preset: String) -> AppResult<DnsStatus> {
    blocking(move || {
        let state = tauri::Manager::state::<AppState>(&app);
        let nic = cached_profile(&state)?.nic.ok_or_else(|| AppError::Unsupported("No connected network adapter".into()))?;
        dns::set(&state.store, &nic, &preset)?;
        Ok(dns::status(Some(&nic), false))
    })
    .await
}

// ---------------------------------------------------------------- my pc

#[tauri::command]
pub async fn list_startup() -> AppResult<Vec<StartupItem>> {
    blocking(|| Ok(startup::list())).await
}

#[tauri::command]
pub fn set_startup(state: State<'_, AppState>, source: String, name: String, enabled: bool) -> AppResult<()> {
    startup::set_enabled(&state.store, &source, &name, enabled)
}

/// Opens a Windows Settings page. Only a fixed allowlist is accepted.
#[tauri::command]
pub fn open_settings(page: String) -> AppResult<()> {
    const ALLOWED: &[&str] = &[
        "ms-settings:gaming-gamemode",
        "ms-settings:gaming-gamebar",
        "ms-settings:display-advancedgraphics",
        "ms-settings:startupapps",
        "ms-settings:powersleep",
    ];
    if !ALLOWED.contains(&page.as_str()) {
        return Err(AppError::Other("That settings page isn't allowed".into()));
    }
    std::process::Command::new("explorer.exe").arg(&page).spawn().map(|_| ()).map_err(AppError::from)
}

// ---------------------------------------------------------------- settings

#[tauri::command]
pub async fn check_update() -> AppResult<UpdateInfo> {
    blocking(updates::check).await
}

/// Downloads and launches the new installer, then closes FreshOptimizer so
/// setup can replace it.
#[tauri::command]
pub async fn install_update(app: AppHandle, url: String) -> AppResult<()> {
    blocking(move || updates::download_and_run(&url)).await?;
    let state = tauri::Manager::state::<AppState>(&app);
    state.engine.stop();
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn open_project_url(url: String) -> AppResult<()> {
    updates::open_project_url(&url)
}

#[tauri::command]
pub async fn get_launch_at_startup() -> AppResult<bool> {
    blocking(|| Ok(updates::startup_enabled())).await
}

#[tauri::command]
pub async fn set_launch_at_startup(enabled: bool) -> AppResult<bool> {
    blocking(move || {
        updates::set_startup(enabled)?;
        Ok(updates::startup_enabled())
    })
    .await
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> AppResult<()> {
    let dir = tauri::Manager::path(&app).app_data_dir().map_err(|e| AppError::Other(e.to_string()))?;
    std::process::Command::new("explorer.exe").arg(dir).spawn().map(|_| ()).map_err(AppError::from)
}

#[tauri::command]
pub fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

// ---------------------------------------------------------------- timer resolution

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerInfo {
    pub mode: crate::timer::Mode,
    pub status: crate::timer::TimerStatus,
    /// Windows 11 only makes a request system-wide when this is set (needs a reboot).
    pub global_allowed: bool,
}

fn timer_info() -> TimerInfo {
    TimerInfo {
        mode: crate::timer::mode(),
        status: crate::timer::status(),
        global_allowed: crate::registry::read_dword(
            crate::registry::Hive::LocalMachine,
            r"SYSTEM\CurrentControlSet\Control\Session Manager\kernel",
            "GlobalTimerResolutionRequests",
        ) == Some(1),
    }
}

#[tauri::command]
pub fn get_timer(_state: State<'_, AppState>) -> TimerInfo {
    timer_info()
}

#[tauri::command]
pub fn set_timer_mode(state: State<'_, AppState>, mode: crate::timer::Mode) -> TimerInfo {
    crate::timer::set_mode(mode, state.engine.status().timer_held);
    timer_info()
}

// ---------------------------------------------------------------- route trace

#[tauri::command]
pub async fn trace_route(host: String) -> AppResult<crate::ping::Trace> {
    blocking(move || Ok(crate::ping::trace(&host, 24, 6))).await
}

fn is_elevated() -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    // SAFETY: token handle checked and closed; output struct sized correctly.
    unsafe {
        let mut token: HANDLE = std::ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return false;
        }
        let mut elev = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        let ok = GetTokenInformation(
            token,
            TokenElevation,
            (&mut elev as *mut TOKEN_ELEVATION).cast(),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut len,
        );
        CloseHandle(token);
        ok != 0 && elev.TokenIsElevated != 0
    }
}
