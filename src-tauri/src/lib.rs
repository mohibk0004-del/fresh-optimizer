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
mod sdr;
mod tcp;
mod live;
mod startup;
mod timer;
mod tweaks;
mod updates;
mod util;

use std::sync::{Arc, Mutex};

use tauri::Manager;

use commands::AppState;

/// `freshoptimizer.exe --rollback`: restore every recorded setting without a UI.
/// Used by the uninstaller. Exit code 0 = fully restored, 1 = some items failed.
fn headless_rollback() -> ! {
    let report = restore::RestoreStore::load(restore::secure_dir()).rollback();
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
                store: Arc::new(restore::RestoreStore::load(restore::secure_dir())),
                engine: engine::Engine::new(),
                prefs: Arc::new(prefs::PrefsStore::load(dir)),
                profile: Mutex::new(None),
                nic_pending_restart: Mutex::new(None),
            });
            // Started by the logon task: stay out of the way in the taskbar.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.minimize();
                }
            }
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
            commands::check_update,
            commands::install_update,
            commands::open_project_url,
            commands::get_launch_at_startup,
            commands::set_launch_at_startup,
            commands::open_data_folder,
            commands::app_version,
            commands::get_timer,
            commands::set_timer_mode,
            commands::trace_route,
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
        println!("nearest relay: {:?}", crate::sdr::nearest());
        let t = crate::ping::trace("1.1.1.1", 20, 4);
        for h in &t.hops {
            println!("hop {} {:?} loss={} avg={:?} jit={:?} dest={}", h.ttl, h.address, h.loss_pct, h.avg_ms, h.jitter_ms, h.is_destination);
        }
        println!("dns: {:?}", crate::dns::status(hw.nic.as_ref(), true).options.iter().map(|o| (o.id, o.lookup_ms)).collect::<Vec<_>>());
        println!("update: {:?}", crate::updates::check().map(|u| (u.current, u.latest, u.available, u.download_url)));
        println!("startup task: {}", crate::updates::startup_enabled());
        for i in crate::startup::list() {
            println!("startup: {} [{}] enabled={} -> {}", i.display, i.source, i.enabled, i.command);
        }
    }
}

#[cfg(test)]
mod latency_variance {
    /// Run with `cargo test --lib latency_variance -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn latency_variance() {
        for _ in 0..8 {
            let r = crate::latency::measure(0).unwrap();
            println!("score={} typical={} max={} long/s={} bursts={}/{}", r.score, r.typical_us, r.max_us, r.long_stalls_per_sec, r.burst_windows, r.windows_total);
        }
    }
}
