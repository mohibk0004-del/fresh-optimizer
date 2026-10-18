//! Match-time engine: a single background thread that wakes every 2 s, takes a
//! ToolHelp process snapshot (~100 µs) and reacts to game start/exit.
//! Idle cost is one snapshot per tick; nothing runs while the engine is stopped.

use std::collections::{HashMap, HashSet};
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
    /// Other programs using a lot of CPU or disk during the match.
    pub hogs: Vec<crate::matchtime::Hog>,
    /// The server the game is talking to, if found, and its latest ping.
    pub server: Option<LiveServer>,
    /// Latest NVIDIA GPU reading while playing.
    pub gpu: Option<crate::gpu::GpuNow>,
    /// Why the game server can't be found (e.g. no admin rights).
    pub server_note: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveServer {
    pub endpoint: crate::netwatch::Endpoint,
    /// None when this ping got no reply.
    pub ping_ms: Option<f64>,
    /// At least one ping to this server was answered this match.
    pub answers_ping: bool,
    /// Last pings, oldest first (None = no reply).
    pub history: Vec<Option<f64>>,
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
    Hog { hog: crate::matchtime::Hog },
}

#[derive(Default)]
struct Inner {
    active: HashMap<u32, ActiveGame>,
    timer_held: bool,
    prior_scheme: Option<String>,
    hogs: Vec<crate::matchtime::Hog>,
    server: Option<LiveServer>,
    gpu: Option<crate::gpu::GpuNow>,
    acc: Option<crate::report::MatchAcc>,
    /// Games that closed while the match was ending: their FPS goes into the report.
    exited: Vec<u32>,
    /// Why server detection isn't available (shown once in the UI).
    netwatch_error: Option<String>,
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
            hogs: inner.hogs.clone(),
            server: inner.server.clone(),
            gpu: inner.gpu.clone(),
            server_note: inner.netwatch_error.clone(),
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
            g.exited.push(pid);
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
        let boosted = !store.summary().applied_tweaks.is_empty();
        crate::fps::start(pid, def.id, def.name, boosted);
        if g.acc.is_none() {
            g.acc = Some(crate::report::MatchAcc::new(def.id, def.name, boosted));
        }
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
        crate::matchtime::on_match_start();
        crate::gpu::session_start();
        let _ = app.emit("engine-event", EngineEvent::MatchMode { active: true, timer_ms: ms });
    }
    if in_match {
        let game_pids: HashSet<u32> = g.active.keys().copied().collect();
        let threads = std::thread::available_parallelism().map(|n| n.get() as u32).unwrap_or(1);
        let (hogs, fresh) = crate::matchtime::sample(&procs, &game_pids, threads);
        if let Some(acc) = g.acc.as_mut() {
            acc.add_hogs(&hogs);
        }
        g.hogs = hogs;
        for hog in fresh {
            let _ = app.emit("engine-event", EngineEvent::Hog { hog });
        }
        // Games that closed while another keeps running: no report yet, just FPS.
        for pid in std::mem::take(&mut g.exited) {
            let app = app.clone();
            thread::spawn(move || {
                if let Some(s) = crate::fps::finish(pid) {
                    let _ = app.emit("fps-session", s);
                }
            });
        }
        let first_watch = g.server.is_none() && g.netwatch_error.is_none();
        // Pinging can take up to a second: don't hold the lock meanwhile.
        drop(g);
        let watch_err = crate::netwatch::watch(game_pids).err();
        let endpoint = crate::netwatch::server();
        let rtt = endpoint.as_ref().filter(|e| e.ip.parse::<std::net::Ipv4Addr>().is_ok()).and_then(|e| crate::ping::once(&e.ip));
        let gpu = crate::gpu::session_sample();
        let mut g = inner.lock().unwrap_or_else(|p| p.into_inner());
        if first_watch {
            g.netwatch_error = watch_err;
        }
        g.gpu = gpu;
        if let Some(ep) = endpoint {
            if let Some(acc) = g.acc.as_mut() {
                acc.add_ping(&ep, rtt);
            }
            let same = g.server.as_ref().is_some_and(|s| s.endpoint.ip == ep.ip && s.endpoint.port == ep.port);
            let mut live = if same { g.server.take().unwrap() } else { LiveServer { endpoint: ep.clone(), ping_ms: None, answers_ping: false, history: Vec::new() } };
            live.endpoint = ep;
            live.ping_ms = rtt;
            live.answers_ping |= rtt.is_some();
            live.history.push(rtt);
            if live.history.len() > 60 {
                live.history.remove(0);
            }
            g.server = Some(live);
        }
    } else if g.timer_held {
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
    crate::matchtime::on_match_end();
    crate::netwatch::stop();
    g.timer_held = false;
    g.hogs.clear();
    g.server = None;
    g.gpu = None;
    g.netwatch_error = None;
    let gpu = crate::gpu::session_end();
    let acc = g.acc.take();
    let exited = std::mem::take(&mut g.exited);
    {
        let app = app.clone();
        thread::spawn(move || {
            // PresentMon flushes once the game is gone; the report waits for it.
            let mut fps = None;
            for pid in exited {
                if let Some(s) = crate::fps::finish(pid) {
                    let _ = app.emit("fps-session", s.clone());
                    fps = fps.or(Some(s));
                }
            }
            if let Some(acc) = acc {
                let report = acc.finish(fps, gpu);
                // Under a minute is usually a crash, a menu peek or a restart.
                if report.seconds >= 60 {
                    crate::report::save(&report);
                    let _ = app.emit("match-report", report);
                }
            }
        });
    }
    if let Some(prior) = g.prior_scheme.take() {
        let _ = power::activate(&prior);
    }
    let _ = app.emit("engine-event", EngineEvent::MatchMode { active: false, timer_ms: timer::status().current_ms });
}
