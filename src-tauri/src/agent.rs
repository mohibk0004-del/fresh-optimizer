//! Settings the backend needs even when no window is open: the tray keeps
//! FreshOptimizer running with only this Rust process (the web UI is closed to
//! free its memory), so these are saved here and applied at startup, not only
//! when the UI loads.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

use crate::commands::AppState;
use crate::timer;

pub static CLOSE_TO_TRAY: AtomicBool = AtomicBool::new(true);
/// Set by "Quit" so closing really exits.
pub static QUITTING: AtomicBool = AtomicBool::new(false);
static CURRENT: Mutex<Option<AgentSettings>> = Mutex::new(None);

/// Alt+Shift+F shows or hides FreshOptimizer.
pub fn hotkey() -> Shortcut {
    Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyF)
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentSettings {
    pub game_watcher: bool,
    pub measure_fps: bool,
    pub pause_updates: bool,
    pub auto_lower: bool,
    pub close_to_tray: bool,
    pub hotkey: bool,
    pub timer_mode: timer::Mode,
}

impl Default for AgentSettings {
    fn default() -> Self {
        AgentSettings { game_watcher: true, measure_fps: true, pause_updates: false, auto_lower: false, close_to_tray: true, hotkey: true, timer_mode: timer::Mode::Match }
    }
}

fn path(app: &AppHandle) -> PathBuf {
    app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("FreshOptimizer")).join("agent.json")
}

pub fn load(app: &AppHandle) -> AgentSettings {
    std::fs::read(path(app)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// Applies settings (only what changed) and saves them.
pub fn apply(app: &AppHandle, s: AgentSettings) {
    let prev = CURRENT.lock().unwrap_or_else(|p| p.into_inner()).replace(s.clone());
    crate::fps::set_enabled(s.measure_fps);
    crate::matchtime::PAUSE_UPDATES.store(s.pause_updates, Ordering::SeqCst);
    crate::matchtime::AUTO_LOWER.store(s.auto_lower, Ordering::SeqCst);
    CLOSE_TO_TRAY.store(s.close_to_tray, Ordering::SeqCst);

    if prev.as_ref().map(|p| p.timer_mode) != Some(s.timer_mode) {
        let in_match = app.state::<AppState>().engine.status().timer_held;
        timer::set_mode(s.timer_mode, in_match);
    }
    if prev.as_ref().map(|p| p.hotkey) != Some(s.hotkey) {
        let gs = app.global_shortcut();
        // Another app may own the combination; then there's simply no hotkey.
        let _ = if s.hotkey { gs.register(hotkey()) } else { gs.unregister(hotkey()) };
    }
    if prev.as_ref().map(|p| p.game_watcher) != Some(s.game_watcher) {
        let app = app.clone();
        let on = s.game_watcher;
        std::thread::spawn(move || {
            let state = app.state::<AppState>();
            if on {
                if let Ok(profile) = crate::commands::cached_profile(&state) {
                    let mask = profile.topology.hybrid.then_some(profile.topology.p_core_mask);
                    state.engine.start(app.clone(), state.store.clone(), state.prefs.clone(), mask);
                }
            } else {
                state.engine.stop();
            }
        });
    }
    if prev.as_ref() != Some(&s) {
        let _ = std::fs::create_dir_all(path(app).parent().unwrap_or(&std::env::temp_dir()));
        let _ = std::fs::write(path(app), serde_json::to_vec_pretty(&s).unwrap_or_default());
    }
}

/// Timer mode is chosen on the PC page; keep it with the rest so it survives restarts.
pub fn set_timer_mode(app: &AppHandle, mode: timer::Mode) {
    let current = CURRENT.lock().unwrap_or_else(|p| p.into_inner()).clone();
    let mut s = current.unwrap_or_else(|| load(app));
    s.timer_mode = mode;
    apply(app, s);
}

/// Brings the main window back, re-creating it if it was closed to the tray.
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == "main") {
        if let Ok(builder) = WebviewWindowBuilder::from_config(app, cfg) {
            if let Ok(w) = builder.build() {
                let _ = w.set_focus();
            }
        }
    }
}

/// Hotkey: hide to tray if FreshOptimizer is in front, otherwise bring it up.
pub fn toggle_main(app: &AppHandle) {
    match app.get_webview_window("main") {
        Some(w) if w.is_focused().unwrap_or(false) && CLOSE_TO_TRAY.load(Ordering::SeqCst) => {
            let _ = w.close();
        }
        Some(w) if w.is_focused().unwrap_or(false) => {
            let _ = w.minimize();
        }
        _ => show_main(app),
    }
}
