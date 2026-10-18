//! Match-time engine: a single background thread that wakes every 2 s, takes a
//! ToolHelp process snapshot (~100 µs) and reacts to game start/exit.
//! Idle cost is one snapshot per tick; nothing runs while the engine is stopped.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::games::{self, EnforceResult};
use crate::power;
use crate::prefs::PrefsStore;
use crate::restore::RestoreStore;
use crate::timer;

const TICK: Duration = Duration::from_secs(2);

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineStatus {
    pub running: bool,
    pub active_games: Vec<ActiveGame>,
    pub timer_held: bool,
    pub power_scheme_active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveGame {
    pub pid: u32,
    pub game: String,
    pub exe: String,
    pub enforce: EnforceResult,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum EngineEvent {
    GameStarted { game: ActiveGame },
    GameExited { pid: u32, game: String },
    MatchMode { active: bool, timer_ms: f64 },
}

#[derive(Default)]
struct Inner {
    active: HashMap<u32, ActiveGame>,
    timer_held: bool,
    prior_scheme: Option<String>,
}

pub struct Engine {
    running: Arc<AtomicBool>,
    inner: Arc<Mutex<Inner>>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl Engine {
    pub fn new() -> Self {
        Engine { running: Arc::new(AtomicBool::new(false)), inner: Arc::default(), worker: Mutex::new(None) }
    }

    pub fn status(&self) -> EngineStatus {
        let inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        EngineStatus {
            running: self.running.load(Ordering::SeqCst),
            active_games: inner.active.values().cloned().collect(),
            timer_held: inner.timer_held,
            power_scheme_active: inner.prior_scheme.is_some(),
        }
    }

    pub fn start(&self, app: AppHandle, store: Arc<RestoreStore>, prefs: Arc<PrefsStore>, p_core_mask: Option<u64>) {
        if self.running.swap(true, Ordering::SeqCst) {
            return;
        }
        let running = self.running.clone();
        let inner = self.inner.clone();
        let handle = thread::Builder::new()
            .name("fo-engine".into())
            .spawn(move || {
                while running.load(Ordering::SeqCst) {
                    tick(&app, &store, &prefs, &inner, p_core_mask);
                    thread::park_timeout(TICK);
                }
                leave_match_mode(&app, &inner);
                crate::fps::finish_all();
                inner.lock().unwrap_or_else(|p| p.into_inner()).active.clear();
            })
            .ok();
        *self.worker.lock().unwrap_or_else(|p| p.into_inner()) = handle;
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
        if let Some(h) = self.worker.lock().unwrap_or_else(|p| p.into_inner()).take() {
            h.thread().unpark();
            let _ = h.join();
        }
    }
}

fn tick(app: &AppHandle, store: &RestoreStore, prefs: &PrefsStore, inner: &Mutex<Inner>, p_core_mask: Option<u64>) {
    let procs = games::list_processes();
    let mut seen = HashMap::new();
    for p in &procs {
        // Games the user switched off on the Games page are left completely alone.
        if let Some(def) = games::game_for_exe(&p.exe).filter(|d| prefs.get(d.id).enabled) {
            seen.insert(p.pid, (def, p.exe.clone()));
        }
    }

    let mut g = inner.lock().unwrap_or_else(|p| p.into_inner());

    // Exits
    let exited: Vec<u32> = g.active.keys().filter(|pid| !seen.contains_key(pid)).cloned().collect();
    for pid in exited {
        if let Some(a) = g.active.remove(&pid) {
            let _ = app.emit("engine-event", EngineEvent::GameExited { pid, game: a.game });
            let app = app.clone();
            thread::spawn(move || {
                if let Some(s) = crate::fps::finish(pid) {
                    let _ = app.emit("fps-session", s);
                }
            });
        }
    }

    // Starts
    for (pid, (def, exe)) in seen {
        if g.active.contains_key(&pid) {
            continue;
        }
        let pref = prefs.get(def.id);
        let enforce = games::enforce(pid, &exe, pref.priority, p_core_mask.filter(|_| pref.fast_cores));
        let game = ActiveGame { pid, game: def.name.into(), exe, enforce };
        crate::fps::start(pid, def.id, def.name, !store.summary().applied_tweaks.is_empty());
        let _ = app.emit("engine-event", EngineEvent::GameStarted { game: game.clone() });
        g.active.insert(pid, game);
    }

    let in_match = !g.active.is_empty();
    if in_match && !g.timer_held {
        let ms = timer::on_match_start();
        g.timer_held = true;
        if let Some(scheme) = power::managed_scheme(store) {
            if let Ok(prior) = power::active_scheme() {
                if prior != scheme && power::activate(&scheme).is_ok() {
                    g.prior_scheme = Some(prior);
                }
            }
        }
        let _ = app.emit("engine-event", EngineEvent::MatchMode { active: true, timer_ms: ms });
    } else if !in_match && g.timer_held {
        drop(g);
        leave_match_mode(app, inner);
    }
}

fn leave_match_mode(app: &AppHandle, inner: &Mutex<Inner>) {
    let mut g = inner.lock().unwrap_or_else(|p| p.into_inner());
    if !g.timer_held && g.prior_scheme.is_none() {
        return;
    }
    timer::on_match_end();
    g.timer_held = false;
    if let Some(prior) = g.prior_scheme.take() {
        let _ = power::activate(&prior);
    }
    let _ = app.emit("engine-event", EngineEvent::MatchMode { active: false, timer_ms: timer::status().current_ms });
}
