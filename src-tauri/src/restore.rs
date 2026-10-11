//! RestorePoint.json: baseline snapshot of everything FO has changed.
//! Entries are recorded before each change and persisted immediately, so a crash
//! mid-boost still leaves a complete rollback trail.

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::registry::{self, Hive, StoredValue};
use crate::{network, power};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Entry {
    Registry {
        hive: Hive,
        path: String,
        name: String,
        prior: Option<StoredValue>,
        /// Topmost key that did not exist before the write (removed again if empty).
        created_from: Option<String>,
    },
    NicProperty {
        adapter: String,
        keyword: String,
        prior: String,
    },
    TcpAutotuning {
        prior: String,
    },
    PowerScheme {
        /// Scheme that was active before FO touched power settings.
        prior_active: String,
        /// Scheme FO created (deleted on rollback).
        created: String,
    },
}

impl Entry {
    /// Identity used to keep only the *first* (true baseline) snapshot of a setting.
    fn identity(&self) -> String {
        match self {
            Entry::Registry { hive, path, name, .. } => {
                format!("reg|{}|{}|{}", hive.label(), path.to_ascii_lowercase(), name.to_ascii_lowercase())
            }
            Entry::NicProperty { adapter, keyword, .. } => format!("nic|{adapter}|{}", keyword.to_ascii_lowercase()),
            Entry::TcpAutotuning { .. } => "tcp|autotuning".into(),
            Entry::PowerScheme { .. } => "power|scheme".into(),
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Entry::Registry { hive, path, name, .. } => format!("{}\\{}\\{}", hive.label(), path, name),
            Entry::NicProperty { adapter, keyword, .. } => format!("NIC '{adapter}' {keyword}"),
            Entry::TcpAutotuning { .. } => "netsh TCP autotuning level".into(),
            Entry::PowerScheme { .. } => "Power scheme".into(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestorePoint {
    pub version: u32,
    pub created_at: u64,
    pub entries: Vec<RecordedEntry>,
    pub applied_tweaks: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedEntry {
    pub tweak: String,
    pub entry: Entry,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub exists: bool,
    pub path: String,
    pub created_at: u64,
    pub entry_count: usize,
    pub applied_tweaks: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackReport {
    pub restored: usize,
    pub failed: Vec<String>,
    pub nic_restarted: bool,
}

pub struct RestoreStore {
    path: PathBuf,
    inner: Mutex<RestorePoint>,
}

impl RestoreStore {
    pub fn load(dir: PathBuf) -> Self {
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("RestorePoint.json");
        let point = fs::read_to_string(&path)
            .ok()
            .and_then(|s| serde_json::from_str::<RestorePoint>(&s).ok())
            .unwrap_or_default();
        RestoreStore { path, inner: Mutex::new(point) }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, RestorePoint> {
        // A poisoned lock still holds valid data; never let it take the app down.
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    fn persist(&self, point: &RestorePoint) -> AppResult<()> {
        if point.entries.is_empty() && point.applied_tweaks.is_empty() {
            match fs::remove_file(&self.path) {
                Ok(()) => return Ok(()),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(e) => return Err(e.into()),
            }
        }
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(point)?)?;
        fs::rename(&tmp, &self.path)?;
        Ok(())
    }

    /// Records a baseline snapshot unless one already exists for this setting.
    pub fn record(&self, tweak: &str, entry: Entry) -> AppResult<()> {
        let mut point = self.lock();
        let id = entry.identity();
        if point.entries.iter().any(|e| e.entry.identity() == id) {
            return Ok(());
        }
        if point.created_at == 0 {
            point.created_at = crate::util::now_unix();
            point.version = 1;
        }
        point.entries.push(RecordedEntry { tweak: tweak.to_string(), entry });
        self.persist(&point)
            .map_err(|e| AppError::Other(format!("could not persist restore point, aborting change: {e}")))
    }

    pub fn mark_applied(&self, tweak: &str) {
        let mut point = self.lock();
        point.applied_tweaks.insert(tweak.to_string());
        let _ = self.persist(&point);
    }

    pub fn find(&self, pred: impl Fn(&Entry) -> bool) -> Option<Entry> {
        self.lock().entries.iter().find(|e| pred(&e.entry)).map(|e| e.entry.clone())
    }

    pub fn summary(&self) -> RestoreSummary {
        let point = self.lock();
        RestoreSummary {
            exists: !point.entries.is_empty(),
            path: self.path.display().to_string(),
            created_at: point.created_at,
            entry_count: point.entries.len(),
            applied_tweaks: point.applied_tweaks.iter().cloned().collect(),
        }
    }

    /// Replays the snapshot in reverse order. Entries that fail stay in the file so
    /// the user can retry; everything else is removed.
    pub fn rollback(&self) -> RollbackReport {
        let mut point = self.lock();
        let mut failed_entries = Vec::new();
        let mut failed = Vec::new();
        let mut restored = 0usize;
        let mut nic_dirty: BTreeSet<String> = BTreeSet::new();

        for rec in point.entries.iter().rev() {
            let result = match &rec.entry {
                Entry::Registry { hive, path, name, prior, created_from } => {
                    registry::restore_value(*hive, path, name, prior, created_from)
                }
                Entry::NicProperty { adapter, keyword, prior } => {
                    let r = network::set_nic_property(adapter, keyword, prior);
                    if r.is_ok() {
                        nic_dirty.insert(adapter.clone());
                    }
                    r
                }
                Entry::TcpAutotuning { prior } => network::set_autotuning(prior),
                Entry::PowerScheme { prior_active, created } => power::restore(prior_active, created),
            };
            match result {
                Ok(()) => restored += 1,
                Err(e) => {
                    failed.push(format!("{}: {e}", rec.entry.describe()));
                    failed_entries.push(rec.clone());
                }
            }
        }

        let nic_restarted = !nic_dirty.is_empty();
        for adapter in &nic_dirty {
            if let Err(e) = network::restart_adapter(adapter) {
                failed.push(format!("restart NIC '{adapter}': {e}"));
            }
        }

        failed_entries.reverse();
        point.entries = failed_entries;
        if point.entries.is_empty() {
            point.applied_tweaks.clear();
            point.created_at = 0;
        }
        let _ = self.persist(&point);
        RollbackReport { restored, failed, nic_restarted }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::registry::{self, Hive};

    /// Round-trip against a throwaway HKCU key: modify, re-modify, roll back.
    #[test]
    fn registry_backup_and_rollback() {
        const ROOT: &str = r"Software\FreshOptimizerSelfTest";
        let existing = format!(r"{ROOT}\Existing");
        let created = format!(r"{ROOT}\Created\Deep");
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(ROOT);
        let (k, _) = hkcu.create_subkey(&existing).unwrap();
        k.set_value("Baseline", &7u32).unwrap();

        let dir = std::env::temp_dir().join(format!("fo-test-{}", std::process::id()));
        let store = RestoreStore::load(dir.clone());

        registry::set_dword_tracked(&store, "t", Hive::CurrentUser, &existing, "Baseline", 1).unwrap();
        // Second write must not overwrite the true baseline snapshot.
        registry::set_dword_tracked(&store, "t", Hive::CurrentUser, &existing, "Baseline", 2).unwrap();
        registry::set_string_tracked(&store, "t", Hive::CurrentUser, &existing, "NewValue", "x").unwrap();
        registry::set_dword_tracked(&store, "t", Hive::CurrentUser, &created, "V", 5).unwrap();
        assert_eq!(store.summary().entry_count, 3);
        assert!(dir.join("RestorePoint.json").exists());

        let report = store.rollback();
        assert!(report.failed.is_empty(), "{:?}", report.failed);
        assert_eq!(report.restored, 3);
        assert_eq!(registry::read_dword(Hive::CurrentUser, &existing, "Baseline"), Some(7));
        assert!(registry::read_raw(Hive::CurrentUser, &existing, "NewValue").is_none());
        assert!(!registry::key_exists(Hive::CurrentUser, &format!(r"{ROOT}\Created")));
        assert!(!dir.join("RestorePoint.json").exists());

        let _ = hkcu.delete_subkey_all(ROOT);
        let _ = std::fs::remove_dir_all(dir);
    }
}
