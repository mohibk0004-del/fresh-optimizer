mod advisor;
mod agent;
mod commands;
mod cpu;
mod display;
mod dns;
mod engine;
mod fps;
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
mod matchtime;
mod icons;
mod selftest;
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
    matchtime::resume_updates();
    std::process::exit(if report.failed.is_empty() { 0 } else { 1 })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if std::env::args().any(|a| a == "--rollback") {
        headless_rollback();
    }
    // Throwaway-machine only (Windows Sandbox / VM): apply everything, verify, undo, verify.
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == "--selftest") {
        let out = args.get(i + 1).map(std::path::PathBuf::from).unwrap_or_else(|| std::env::temp_dir().join("fo-selftest.json"));
        std::process::exit(if selftest::run(&out) { 0 } else { 1 });
    }
    tauri::Builder::default()
        // Opening FreshOptimizer again (Start menu, logon task) brings back the running one.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| agent::show_main(app)))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if *shortcut == agent::hotkey() && event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        agent::toggle_main(app);
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("FreshOptimizer"));
            // A game was still running when the app last closed: undo the update pause.
            std::thread::spawn(matchtime::resume_updates);
            app.manage(AppState {
                store: Arc::new(restore::RestoreStore::load(restore::secure_dir())),
                engine: engine::Engine::new(),
                prefs: Arc::new(prefs::PrefsStore::load(dir)),
                profile: Mutex::new(None),
                nic_pending_restart: Mutex::new(None),
            });
            let handle = app.handle().clone();
            let settings = agent::load(&handle);
            agent::apply(&handle, settings);
            tray(&handle)?;
            // Started by the logon task: stay out of the way (tray only, if allowed).
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(w) = app.get_webview_window("main") {
                    if agent::CLOSE_TO_TRAY.load(std::sync::atomic::Ordering::SeqCst) {
                        let _ = w.close();
                    } else {
                        let _ = w.minimize();
                    }
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
            commands::list_displays,
            commands::game_advice,
            commands::set_agent_settings,
            commands::get_agent_settings,
            commands::hog_lower,
            commands::hog_close,
            commands::fps_status,
            commands::fps_install,
            commands::fps_uninstall,
            commands::fps_clear,
            commands::set_refresh_rate,
            commands::set_timer_mode,
            commands::trace_route,
            commands::game_icons,
            commands::set_wallpaper,
            commands::get_wallpaper,
            commands::clear_wallpaper,
        ])
        .build(tauri::generate_context!())
        .expect("error while building FreshOptimizer")
        .run(|app, event| {
            // Closing the window keeps FreshOptimizer in the tray (UI memory is freed).
            if let tauri::RunEvent::ExitRequested { api, code: None, .. } = &event {
                if agent::CLOSE_TO_TRAY.load(std::sync::atomic::Ordering::SeqCst) && !agent::QUITTING.load(std::sync::atomic::Ordering::SeqCst) {
                    api.prevent_exit();
                    return;
                }
            }
            // Always release the timer request and restore the user's power scheme.
            if let tauri::RunEvent::Exit = event {
                if let Some(state) = app.try_state::<AppState>() {
                    state.engine.stop();
                }
                timer::release();
                fps::finish_all();
            }
        });
}

fn tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    let open = MenuItem::with_id(app, "open", "Open FreshOptimizer", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").tooltip("FreshOptimizer").menu(&menu).show_menu_on_left_click(false);
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.on_menu_event(|app, e| match e.id.as_ref() {
        "open" => agent::show_main(app),
        "quit" => {
            agent::QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
            app.exit(0);
        }
        _ => {}
    })
    .on_tray_icon_event(|tray, e| {
        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
            agent::show_main(tray.app_handle());
        }
    })
    .build(app)?;
    Ok(())
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
        println!("displays: {:?}", crate::display::list());
        let ctx = crate::advisor::Context { max_hz: crate::display::list().iter().find(|d| d.primary).map(|d| d.max_hz).unwrap_or(0), nvidia: true };
        for (id, a) in crate::advisor::all(&ctx) {
            println!("advice {id}: {}", a.file);
            for c in a.checks {
                println!("   {} = {} ok={} tip={:?}", c.name, c.value, c.ok, c.tip.is_some());
            }
        }
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
        for g in crate::games::discover() { if let Some(p) = g.exe_paths.first() { println!("icon {}: {:?}", g.id, crate::icons::exe_icon(p, 128).map(|d| d.len())); } }
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
