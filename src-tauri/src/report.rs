//! Match report: one summary per play session, built from what was actually
//! measured (FPS from PresentMon, server ping, GPU from NVML, busy background apps).
//! Anything that wasn't measured is left out, never estimated.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::fps::Session;
use crate::gpu::GpuSummary;
use crate::matchtime::Hog;
use crate::netwatch::Endpoint;

const MAX_REPORTS: usize = 100;
static FILE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerStats {
    pub ip: String,
    pub port: u16,
    pub udp: bool,
    /// False when the server never answered a ping (Riot, some others block it).
    pub answers_ping: bool,
    pub avg_ms: Option<f64>,
    pub min_ms: Option<f64>,
    pub max_ms: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub loss_pct: Option<f64>,
    pub samples: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HogSeen {
    pub exe: String,
    pub max_cpu_pct: f64,
    pub max_disk_mbps: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MatchReport {
    pub game_id: String,
    pub game: String,
    pub started: u64,
    pub seconds: u64,
    pub boosted: bool,
    pub fps: Option<Session>,
    pub server: Option<ServerStats>,
    pub gpu: Option<GpuSummary>,
    pub hogs: Vec<HogSeen>,
}

/// Collected during the match by the engine.
#[derive(Default)]
pub struct MatchAcc {
    pub game_id: String,
    pub game: String,
    pub started: u64,
    pub boosted: bool,
    /// Pings per server endpoint (None = no reply).
    servers: HashMap<(String, u16, bool), Vec<Option<f64>>>,
    hogs: HashMap<String, (f64, f64)>,
}

impl MatchAcc {
    pub fn new(game_id: &str, game: &str, boosted: bool) -> Self {
        MatchAcc { game_id: game_id.into(), game: game.into(), started: crate::util::now_unix(), boosted, ..Default::default() }
    }

    pub fn add_ping(&mut self, ep: &Endpoint, rtt: Option<f64>) {
        self.servers.entry((ep.ip.clone(), ep.port, ep.udp)).or_default().push(rtt);
    }

    pub fn add_hogs(&mut self, hogs: &[Hog]) {
        for h in hogs.iter().filter(|h| !h.protected) {
            let e = self.hogs.entry(h.exe.clone()).or_default();
            e.0 = e.0.max(h.cpu_pct);
            e.1 = e.1.max(h.disk_mbps);
        }
    }

    pub fn finish(self, fps: Option<Session>, gpu: Option<GpuSummary>) -> MatchReport {
        let seconds = crate::util::now_unix().saturating_sub(self.started);
        // The server the game talked to most (most samples).
        let server = self.servers.into_iter().max_by_key(|(_, v)| v.len()).map(|((ip, port, udp), v)| server_stats(ip, port, udp, &v));
        let mut hogs: Vec<HogSeen> = self.hogs.into_iter().map(|(exe, (c, d))| HogSeen { exe, max_cpu_pct: c, max_disk_mbps: d }).collect();
        hogs.sort_by(|a, b| b.max_cpu_pct.partial_cmp(&a.max_cpu_pct).unwrap_or(std::cmp::Ordering::Equal));
        MatchReport { game_id: self.game_id, game: self.game, started: self.started, seconds, boosted: self.boosted, fps, server, gpu, hogs }
    }
}

fn server_stats(ip: String, port: u16, udp: bool, v: &[Option<f64>]) -> ServerStats {
    let ok: Vec<f64> = v.iter().flatten().copied().collect();
    let r1 = |x: f64| (x * 10.0).round() / 10.0;
    let answers = !ok.is_empty();
    let jitter = (ok.len() > 1).then(|| ok.windows(2).map(|w| (w[1] - w[0]).abs()).sum::<f64>() / (ok.len() - 1) as f64);
    ServerStats {
        ip,
        port,
        udp,
        answers_ping: answers,
        avg_ms: answers.then(|| r1(ok.iter().sum::<f64>() / ok.len() as f64)),
        min_ms: ok.iter().copied().reduce(f64::min).map(r1),
        max_ms: ok.iter().copied().reduce(f64::max).map(r1),
        jitter_ms: jitter.map(r1),
        // Loss only means something if the server answers pings at all.
        loss_pct: answers.then(|| r1((v.len() - ok.len()) as f64 / v.len() as f64 * 100.0)),
        samples: v.len() as u32,
    }
}

fn path() -> std::path::PathBuf {
    crate::restore::secure_dir().join("matches.json")
}

pub fn list() -> Vec<MatchReport> {
    std::fs::read(path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save(r: &MatchReport) {
    let _g = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let mut all = list();
    all.push(r.clone());
    if all.len() > MAX_REPORTS {
        let n = all.len() - MAX_REPORTS;
        all.drain(..n);
    }
    let _ = std::fs::write(path(), serde_json::to_vec(&all).unwrap_or_default());
}

pub fn clear() {
    let _g = FILE_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _ = std::fs::remove_file(path());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_report_from_measurements() {
        let mut acc = MatchAcc::new("cs2", "Counter-Strike 2", true);
        let ep = Endpoint { ip: "155.133.1.1".into(), port: 27015, udp: true, packets_per_sec: 64.0 };
        for r in [Some(20.0), Some(22.0), None, Some(21.0)] {
            acc.add_ping(&ep, r);
        }
        let silent = Endpoint { ip: "1.2.3.4".into(), port: 7000, udp: true, packets_per_sec: 10.0 };
        acc.add_ping(&silent, None);
        let r = acc.finish(None, None);
        let s = r.server.unwrap();
        assert_eq!(s.ip, "155.133.1.1");
        assert_eq!(s.avg_ms, Some(21.0));
        assert_eq!(s.loss_pct, Some(25.0));
        assert_eq!(s.samples, 4);
        let quiet = server_stats("1.2.3.4".into(), 7000, true, &[None, None]);
        assert!(!quiet.answers_ping);
        assert_eq!(quiet.loss_pct, None);
    }
}
