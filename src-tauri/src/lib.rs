mod commands;
mod cpu;
mod dns;
mod engine;
mod error;
mod games;
mod hardware;
mod latency;
mod network;
mod ping;
mod power;
mod prefs;
mod registry;
mod restore;
mod startup;
mod timer;
mod tweaks;
mod util;

use std::sync::{Arc, Mutex};

use tauri::Manager;

use commands::AppState;

/// Must match `identifier` in tauri.conf.json (Tauri's app_data_dir on Windows).
const APP_IDENTIFIER: &str = "com.freshoptimizer.app";

/// `freshoptimizer.exe --rollback`: restore every recorded setting without a UI.
/// Used by the uninstaller. Exit code 0 = fully restored, 1 = some items failed.
fn headless_rollback() -> ! {
    let dir = std::env::var_os("APPDATA")
        .map(|a| std::path::PathBuf::from(a).join(APP_IDENTIFIER))
        .unwrap_or_else(|| std::env::temp_dir().join("FreshOptimizer"));
    let report = restore::RestoreStore::load(dir).rollback();
    timer::release();
    std::process::exit(if report.failed.is_empty() { 0 } else { 1 })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::args().any(|a| a == "--rollback") {
        headless_rollback();
    }
    tauri::Builder::default()
        .setup(|app| {
            let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("FreshOptimizer"));
            app.manage(AppState {
                store: Arc::new(restore::RestoreStore::load(dir.clone())),
                engine: engine::Engine::new(),
                prefs: Arc::new(prefs::PrefsStore::load(dir)),
                profile: Mutex::new(None),
                nic_pending_restart: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_system_info,
            commands::measure_latency,
            commands::get_games,
            commands::list_tweaks,
            commands::apply_tweak,
            commands::finalize_boost,
            commands::restore_summary,
            commands::rollback,
            commands::engine_start,
            commands::engine_stop,
            commands::engine_status,
            commands::ping_probe,
            commands::ping_once,
            commands::nic_properties,
            commands::flush_dns,
            commands::reset_winsock,
            commands::get_game_prefs,
            commands::set_game_prefs,
            commands::launch_game,
            commands::open_game_folder,
            commands::set_nic_setting,
            commands::restart_adapter,
            commands::dns_status,
            commands::set_dns,
            commands::list_startup,
            commands::set_startup,
            commands::open_settings,
        ])
        .build(tauri::generate_context!())
        .expect("error while building FreshOptimizer")
        .run(|app, event| {
            // Always release the timer request and restore the user's power scheme.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.engine.stop();
                }
                timer::release();
            }
        });
}

#[cfg(test)]
mod smoke {
    //! Read-only probes against the real machine. No settings are modified.
    #[test]
    fn read_only_probes() {
        let t = crate::cpu::topology();
        println!("topology: {t:?}");
        assert!(t.logical_threads > 0);
        println!("timer: {:?}", crate::timer::status());
        println!("latency: {:?}", crate::latency::measure(300).unwrap());
        println!("ping 1.1.1.1: {:?}", crate::ping::once("1.1.1.1"));
        let hw = crate::hardware::profile().unwrap();
        println!("hw: {}", serde_json::to_string_pretty(&hw).unwrap());
        println!("live: {:?}", crate::hardware::live_status());
        println!("games: {:?}", crate::games::discover());
        println!("autotuning: {:?}", crate::network::read_autotuning());
        if let Some(nic) = &hw.nic {
            println!("nic props: {:?}", crate::network::read_properties(&nic.name));
        }
        println!("power: {:?}", crate::power::active_scheme());
        println!("dns: {:?}", crate::dns::status(hw.nic.as_ref(), true));
        for i in crate::startup::list() {
            println!("startup: {} [{}] enabled={} -> {}", i.display, i.source, i.enabled, i.command);
        }
    }
}
