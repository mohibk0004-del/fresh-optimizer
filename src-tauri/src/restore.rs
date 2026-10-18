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
use crate::{dns, network, power, tcp};

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
    /// One allowlisted TCP/IP stack setting (see tcp.rs).
    Tcp {
        knob: tcp::Knob,
        prior: String,
    },
    Dns {
        if_index: u32,
        adapter: String,
        /// Static server list before the change ("" = automatic).
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
            Entry::Tcp { knob, .. } => format!("tcpknob|{knob:?}"),
            Entry::Dns { adapter, .. } => format!("dns|{adapter}"),
            Entry::PowerScheme { .. } => "power|scheme".into(),
        }
    }

    pub fn describe(&self) -> String {
        match self {
            Entry::Registry { hive, path, name, .. } => format!("{}\\{}\\{}", hive.label(), path, name),
            Entry::NicProperty { adapter, keyword, .. } => format!("NIC '{adapter}' {keyword}"),
            Entry::TcpAutotuning { .. } => "netsh TCP autotuning level".into(),
            Entry::Tcp { knob, .. } => knob.label().into(),
            Entry::Dns { adapter, .. } => format!("DNS servers on '{adapter}'"),
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

    /// (tweak id, entry) for everything recorded, oldest first.
    pub fn recorded(&self) -> Vec<(String, Entry)> {
        self.lock().entries.iter().map(|e| (e.tweak.clone(), e.entry.clone())).collect()
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
        self.rollback_where(|_| true)
    }

    /// Undoes only the changes recorded for these tweaks (newest first).
    pub fn rollback_tweaks(&self, tweaks: &[&str]) -> RollbackReport {
        let report = self.rollback_where(|t| tweaks.contains(&t));
        if report.failed.is_empty() {
            let mut point = self.lock();
            for t in tweaks {
                point.applied_tweaks.remove(*t);
            }
            let _ = self.persist(&point);
        }
        report
    }

    fn rollback_where(&self, pick: impl Fn(&str) -> bool) -> RollbackReport {
        let mut point = self.lock();
        let mut kept = Vec::new();
        let mut failed = Vec::new();
        let mut restored = 0usize;
        let mut nic_dirty: BTreeSet<String> = BTreeSet::new();

        for rec in point.entries.iter().rev() {
            if !pick(&rec.tweak) {
                kept.push(rec.clone());
                continue;
            }
            match restore_entry(&rec.entry, &mut nic_dirty) {
                Ok(()) => restored += 1,
                Err(e) => {
                    failed.push(format!("{}: {e}", rec.entry.describe()));
                    kept.push(rec.clone());
                }
            }
        }

        crate::live::refresh();
        let nic_restarted = !nic_dirty.is_empty();
        for adapter in &nic_dirty {
            if let Err(e) = network::restart_adapter(adapter) {
                failed.push(format!("restart NIC '{adapter}': {e}"));
            }
        }

        kept.reverse();
        point.entries = kept;
        if point.entries.is_empty() && point.applied_tweaks.iter().all(|t| pick(t)) {
            point.applied_tweaks.clear();
            point.created_at = 0;
        }
        let _ = self.persist(&point);
        RollbackReport { restored, failed, nic_restarted }
    }
}

fn restore_entry(entry: &Entry, nic_dirty: &mut BTreeSet<String>) -> AppResult<()> {
    match entry {
        Entry::Registry { hive, path, name, prior, created_from } => registry::restore_value(*hive, path, name, prior, created_from),
        Entry::NicProperty { adapter, keyword, prior } => {
            let r = network::set_nic_property(adapter, keyword, prior);
            if r.is_ok() {
                nic_dirty.insert(adapter.clone());
            }
            r
        }
        Entry::TcpAutotuning { prior } => network::set_autotuning(prior),
        Entry::Tcp { knob, prior } => tcp::write(*knob, prior),
        Entry::Dns { if_index, prior, .. } => dns::restore(*if_index, prior),
        Entry::PowerScheme { prior_active, created } => power::restore(prior_active, created),
    }
}

fn fmt_stored(v: &Option<StoredValue>) -> String {
    match v {
        None => "(not set)".into(),
        Some(v) if v.vtype == 4 && v.data.len() >= 4 => u32::from_le_bytes(v.data[..4].try_into().unwrap()).to_string(),
        Some(v) if v.vtype == 1 || v.vtype == 2 => {
            let w: Vec<u16> = v.data.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            format!("\"{}\"", crate::util::wide_to_string(&w))
        }
        Some(v) => format!("{} bytes of data", v.data.len()),
    }
}

/// The value as it is on the system right now.
pub fn current_value(e: &Entry) -> String {
    match e {
        Entry::Registry { hive, path, name, .. } => fmt_stored(&registry::read_raw(*hive, path, name)),
        Entry::NicProperty { adapter, keyword, .. } => network::read_properties(adapter)
            .ok()
            .and_then(|p| p.into_iter().find(|x| x.keyword.eq_ignore_ascii_case(keyword)))
            .map(|p| p.value)
            .unwrap_or_else(|| "(unreadable)".into()),
        Entry::TcpAutotuning { .. } => network::read_autotuning().unwrap_or_else(|e| format!("(error {e})")),
        Entry::Tcp { knob, .. } => tcp::read(*knob).unwrap_or_else(|e| format!("(error {e})")),
        Entry::Dns { if_index, .. } => dns::static_servers_by_index(*if_index),
        Entry::PowerScheme { .. } => format!("active plan {}", power::active_scheme().unwrap_or_default()),
    }
}

/// The original value the entry recorded, in the same format as `current_value`.
pub fn before_value(e: &Entry) -> String {
    match e {
        Entry::Registry { prior, .. } => fmt_stored(prior),
        Entry::NicProperty { prior, .. } | Entry::TcpAutotuning { prior } | Entry::Tcp { prior, .. } | Entry::Dns { prior, .. } => {
            if prior.is_empty() {
                "(automatic)".into()
            } else {
                prior.clone()
            }
        }
        Entry::PowerScheme { prior_active, .. } => format!("active plan {prior_active}"),
    }
}

/// Where the restore point lives.
///
/// FreshOptimizer runs elevated and replays this file on Undo, so it must not
/// be writable by non-admin programs. %APPDATA% is writable by everything the
/// user runs, so the file lives in %ProgramData%\FreshOptimizer, locked to
/// Administrators and SYSTEM (everyone else can only read it).
pub fn secure_dir() -> PathBuf {
    let base = std::env::var_os("ProgramData").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\ProgramData"));
    let dir = base.join("FreshOptimizer");
    let fresh = !dir.exists();
    let _ = fs::create_dir_all(&dir);
    if fresh || !acl_locked(&dir) {
        lock_acl(&dir);
    }
    migrate_legacy(&dir.join("RestorePoint.json"));
    dir
}

fn acl_locked(dir: &std::path::Path) -> bool {
    dir.join(".acl").exists()
}

fn lock_acl(dir: &std::path::Path) {
    // S-1-5-32-544 Administrators, S-1-5-18 SYSTEM, S-1-5-32-545 Users (read-only).
    let ok = crate::util::run_hidden(
        "icacls",
        &[
            &dir.display().to_string(),
            "/inheritance:r",
            "/grant:r",
            "*S-1-5-32-544:(OI)(CI)F",
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-545:(OI)(CI)RX",
        ],
    )
    .is_ok();
    if ok {
        let _ = fs::write(dir.join(".acl"), b"locked");
    }
}

/// One-time move from the old user-writable location (0.1.0 - 0.3.0).
fn migrate_legacy(target: &std::path::Path) {
    if target.exists() {
        return;
    }
    let Some(appdata) = std::env::var_os("APPDATA") else { return };
    let old = PathBuf::from(appdata).join("com.freshoptimizer.app").join("RestorePoint.json");
    if old.exists() && fs::copy(&old, target).is_ok() {
        let _ = fs::remove_file(old);
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

    /// Undoing one tweak leaves every other tweak's changes alone.
    #[test]
    fn rollback_single_tweak() {
        const ROOT: &str = r"Software\FreshOptimizerSelfTest2";
        let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(ROOT);
        let dir = std::env::temp_dir().join(format!("fo-test2-{}", std::process::id()));
        let store = RestoreStore::load(dir.clone());

        registry::set_dword_tracked(&store, "a", Hive::CurrentUser, ROOT, "A", 1).unwrap();
        store.mark_applied("a");
        registry::set_dword_tracked(&store, "b", Hive::CurrentUser, ROOT, "B", 2).unwrap();
        store.mark_applied("b");

        let r = store.rollback_tweaks(&["a"]);
        assert!(r.failed.is_empty(), "{:?}", r.failed);
        assert_eq!(r.restored, 1);
        assert!(registry::read_raw(Hive::CurrentUser, ROOT, "A").is_none());
        assert_eq!(registry::read_dword(Hive::CurrentUser, ROOT, "B"), Some(2));
        assert_eq!(store.summary().applied_tweaks, vec!["b".to_string()]);
        assert_eq!(before_value(&store.recorded()[0].1), "(not set)");
        assert_eq!(current_value(&store.recorded()[0].1), "2");

        store.rollback();
        assert!(!dir.join("RestorePoint.json").exists());
        let _ = hkcu.delete_subkey_all(ROOT);
        let _ = std::fs::remove_dir_all(dir);
    }
}
