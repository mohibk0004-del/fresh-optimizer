//! `freshoptimizer.exe --selftest <report.json>`: end-to-end check of every
//! change FreshOptimizer can make, and of Undo.
//!
//! **Run this only on a throwaway machine** (Windows Sandbox or a VM). It
//! really applies every tweak, reads each recorded setting back to prove it
//! changed, runs Undo, and reads everything again to prove it's back to the
//! original value. The restore point lives in a temp folder so a real one is
//! never touched.

use serde::Serialize;

use crate::hardware;
use crate::network;
use crate::power;
use crate::registry::{self, StoredValue};
use crate::restore::{Entry, RestoreStore};
use crate::tcp;
use crate::tweaks::{self, Status};
use crate::util;

#[derive(Serialize)]
struct TweakRow {
    id: String,
    status: String,
    detail: String,
}

#[derive(Serialize)]
struct EntryRow {
    tweak: String,
    what: String,
    before: String,
    after_apply: String,
    after_undo: String,
    /// The change really happened.
    changed: bool,
    /// Undo put it back exactly.
    restored: bool,
}

#[derive(Serialize)]
struct Report {
    windows: String,
    tweaks: Vec<TweakRow>,
    entries: Vec<EntryRow>,
    undo_failures: Vec<String>,
    passed: bool,
}

fn fmt_stored(v: &Option<StoredValue>) -> String {
    match v {
        None => "(absent)".into(),
        Some(v) if v.vtype == 4 && v.data.len() >= 4 => format!("dword {}", u32::from_le_bytes(v.data[..4].try_into().unwrap())),
        Some(v) if v.vtype == 1 || v.vtype == 2 => {
            let w: Vec<u16> = v.data.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            format!("sz \"{}\"", util::wide_to_string(&w))
        }
        Some(v) => format!("type{} {} bytes {:02x?}", v.vtype, v.data.len(), &v.data[..v.data.len().min(12)]),
    }
}

/// The value as it is on the system right now.
fn current(e: &Entry) -> String {
    match e {
        Entry::Registry { hive, path, name, .. } => fmt_stored(&registry::read_raw(*hive, path, name)),
        Entry::NicProperty { adapter, keyword, .. } => network::read_properties(adapter)
            .ok()
            .and_then(|p| p.into_iter().find(|x| x.keyword.eq_ignore_ascii_case(keyword)))
            .map(|p| p.value)
            .unwrap_or_else(|| "(unreadable)".into()),
        Entry::TcpAutotuning { .. } => network::read_autotuning().unwrap_or_else(|e| format!("(error {e})")),
        Entry::Tcp { knob, .. } => tcp::read(*knob).unwrap_or_else(|e| format!("(error {e})")),
        Entry::Dns { if_index, .. } => crate::dns::static_servers_by_index(*if_index),
        Entry::PowerScheme { created, .. } => format!(
            "active={} created_exists={}",
            power::active_scheme().unwrap_or_default(),
            util::run_hidden("powercfg", &["/query", created]).is_ok()
        ),
    }
}

/// The baseline the entry recorded, in the same format as `current`.
fn before(e: &Entry) -> String {
    match e {
        Entry::Registry { prior, .. } => fmt_stored(prior),
        Entry::NicProperty { prior, .. } | Entry::TcpAutotuning { prior } | Entry::Tcp { prior, .. } | Entry::Dns { prior, .. } => prior.clone(),
        Entry::PowerScheme { prior_active, .. } => format!("active={prior_active} created_exists=false"),
    }
}

pub fn run(out: &std::path::Path) -> bool {
    let dir = std::env::temp_dir().join(format!("fo-selftest-{}", std::process::id()));
    let store = RestoreStore::load(dir.clone());
    let profile = hardware::profile().ok();
    let nic = profile.as_ref().and_then(|p| p.nic.clone());
    let ctx = tweaks::Ctx { store: &store, nic: nic.as_ref() };

    // 1. Every tweak, including the ones that are off by default.
    let mut tweak_rows = Vec::new();
    for t in tweaks::CATALOG {
        let r = tweaks::apply(t.id, &ctx);
        let status = match r.status {
            Status::Applied => "applied",
            Status::Skipped => "skipped",
            Status::Failed => "failed",
        };
        tweak_rows.push(TweakRow { id: t.id.into(), status: status.into(), detail: r.detail });
    }
    // 2. Manual features that also go through the restore point.
    if let Some(n) = &nic {
        let r = crate::dns::set(&store, n, "cloudflare");
        tweak_rows.push(TweakRow { id: "manual_dns".into(), status: if r.is_ok() { "applied" } else { "failed" }.into(), detail: format!("{r:?}") });
    }
    if let Some(item) = crate::startup::list().into_iter().find(|i| i.enabled) {
        let r = crate::startup::set_enabled(&store, item.source, &item.name, false);
        tweak_rows.push(TweakRow { id: "manual_startup".into(), status: if r.is_ok() { "applied" } else { "failed" }.into(), detail: item.display });
    }
    if let Some(n) = &nic {
        let _ = network::restart_adapter(&n.name);
    }

    // 3. Snapshot after applying.
    let recorded: Vec<(String, Entry)> = store.recorded();
    let applied: Vec<String> = recorded.iter().map(|(_, e)| current(e)).collect();

    // 4. Undo, then snapshot again.
    let report = store.rollback();
    let mut entries = Vec::new();
    for ((tweak, e), after_apply) in recorded.iter().zip(applied) {
        let b = before(e);
        let after_undo = current(e);
        let restored = match e {
            // Undo re-activates the old plan and deletes ours.
            Entry::PowerScheme { prior_active, created } => {
                power::active_scheme().unwrap_or_default() == *prior_active && util::run_hidden("powercfg", &["/query", created]).is_err()
            }
            _ => after_undo == b,
        };
        entries.push(EntryRow { tweak: tweak.clone(), what: e.describe(), changed: after_apply != b, restored, before: b, after_apply, after_undo });
    }

    let failed_tweaks = tweak_rows.iter().any(|r| r.status == "failed");
    let passed = !failed_tweaks && report.failed.is_empty() && entries.iter().all(|e| e.restored);
    let full = Report {
        windows: util::powershell("(Get-CimInstance Win32_OperatingSystem).Caption + ' ' + (Get-CimInstance Win32_OperatingSystem).BuildNumber")
            .unwrap_or_default()
            .trim()
            .into(),
        tweaks: tweak_rows,
        entries,
        undo_failures: report.failed,
        passed,
    };
    let _ = std::fs::write(out, serde_json::to_vec_pretty(&full).unwrap_or_default());
    let _ = std::fs::remove_dir_all(dir);
    passed
}
