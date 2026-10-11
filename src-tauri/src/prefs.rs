//! Per-game preferences (games.json in the app data dir). The match engine
//! reads them on every game start, so changes apply to the next launch.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    High,
    AboveNormal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GamePrefs {
    /// Engine boosts this game when it starts.
    pub enabled: bool,
    pub priority: Priority,
    /// Restrict to performance cores on hybrid CPUs.
    pub fast_cores: bool,
}

impl Default for GamePrefs {
    fn default() -> Self {
        GamePrefs { enabled: true, priority: Priority::High, fast_cores: true }
    }
}

pub struct PrefsStore {
    path: PathBuf,
    map: Mutex<HashMap<String, GamePrefs>>,
}

impl PrefsStore {
    pub fn load(dir: PathBuf) -> Self {
        let path = dir.join("games.json");
        let map = fs::read_to_string(&path).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        PrefsStore { path, map: Mutex::new(map) }
    }

    pub fn get(&self, id: &str) -> GamePrefs {
        self.map.lock().unwrap_or_else(|p| p.into_inner()).get(id).cloned().unwrap_or_default()
    }

    pub fn all(&self, ids: &[&str]) -> HashMap<String, GamePrefs> {
        ids.iter().map(|id| (id.to_string(), self.get(id))).collect()
    }

    pub fn set(&self, id: &str, prefs: GamePrefs) -> std::io::Result<()> {
        let mut map = self.map.lock().unwrap_or_else(|p| p.into_inner());
        map.insert(id.to_string(), prefs);
        fs::write(&self.path, serde_json::to_vec_pretty(&*map).unwrap_or_default())
    }
}
