//! Valve Steam Datagram Relay (SDR) points of presence. CS2 match traffic is
//! carried over these relays, so pinging the nearest one is a far more honest
//! "CS2 route" than pinging steampowered.com (a website).

use std::sync::Mutex;
use std::thread;

use serde::Deserialize;

use crate::ping;
use crate::util::{self, ps_quote};

const CONFIG_URL: &str = "https://api.steampowered.com/ISteamApps/GetSDRConfig/v1/?appid=730";

#[derive(Debug, Clone)]
pub struct Relay {
    pub city: String,
    pub ip: String,
    pub ping_ms: f64,
}

#[derive(Deserialize)]
struct Config {
    #[serde(default)]
    pops: std::collections::HashMap<String, Pop>,
}

#[derive(Deserialize)]
struct Pop {
    #[serde(default)]
    desc: String,
    #[serde(default)]
    relays: Vec<RelayIp>,
}

#[derive(Deserialize)]
struct RelayIp {
    ipv4: Option<String>,
}

/// Cached for the session. A failed lookup is cached too, so probes stay fast.
static NEAREST: Mutex<Option<Option<Relay>>> = Mutex::new(None);

fn fetch() -> Option<Vec<(String, String)>> {
    let script = format!(
        "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;\
         (Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 -Uri {}).Content",
        ps_quote(CONFIG_URL)
    );
    let cfg: Config = serde_json::from_str(util::powershell(&script).ok()?.trim()).ok()?;
    Some(
        cfg.pops
            .into_values()
            .filter_map(|p| {
                let ip = p.relays.into_iter().find_map(|r| r.ipv4)?;
                // "Amsterdam (Netherlands)" -> "Amsterdam"
                let city = p.desc.split(" (").next().unwrap_or(&p.desc).trim().to_string();
                Some((city, ip))
            })
            .collect(),
    )
}

/// Pings one relay per location in parallel and returns the closest.
pub fn nearest() -> Option<Relay> {
    if let Some(cached) = NEAREST.lock().unwrap_or_else(|p| p.into_inner()).clone() {
        return cached;
    }
    let found = fetch().and_then(|pops| {
        let results: Vec<Relay> = thread::scope(|sc| {
            let hs: Vec<_> = pops
                .iter()
                .map(|(city, ip)| sc.spawn(move || ping::once(ip).map(|ms| Relay { city: city.clone(), ip: ip.clone(), ping_ms: ms })))
                .collect();
            hs.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
        });
        results.into_iter().min_by(|a, b| a.ping_ms.partial_cmp(&b.ping_ms).unwrap_or(std::cmp::Ordering::Equal))
    });
    *NEAREST.lock().unwrap_or_else(|p| p.into_inner()) = Some(found.clone());
    found
}
