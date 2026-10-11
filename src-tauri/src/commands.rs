//! Tauri IPC surface. Blocking work (PowerShell, ICMP, netsh) always runs on the
//! blocking pool so the UI thread never stalls.

use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::engine::{Engine, EngineStatus};
use crate::error::{AppError, AppResult};
use crate::games::{self, GameInfo};
use crate::hardware::{self, HardwareProfile, LiveStatus};
use crate::latency::{self, LatencyReport};
use crate::network::{self, NicProperty};
use crate::ping::{self, PingStats, PingTarget};
use crate::restore::{RestoreStore, RestoreSummary, RollbackReport};
use crate::tweaks::{self, TweakInfo, TweakResult};

pub struct AppState {
    pub store: Arc<RestoreStore>,
    pub engine: Engine,
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
        state.engine.start(app.clone(), state.store.clone(), mask);
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
