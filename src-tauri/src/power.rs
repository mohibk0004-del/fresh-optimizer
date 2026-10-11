//! Custom low-DPC power scheme. Created once (tracked in the restore point) and
//! only *activated* while a game is running; the user's own scheme is restored
//! as soon as the match ends.

use crate::error::{AppError, AppResult};
use crate::restore::{Entry, RestoreStore};
use crate::util::{self, find_guid};

const HIGH_PERFORMANCE: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
pub const SCHEME_NAME: &str = "FO Low-DPC";

pub fn active_scheme() -> AppResult<String> {
    let out = util::run_hidden("powercfg", &["/getactivescheme"])?;
    find_guid(&out).ok_or_else(|| AppError::Command("could not parse active power scheme".into()))
}

fn scheme_exists(guid: &str) -> bool {
    util::run_hidden("powercfg", &["/query", guid]).is_ok()
}

pub fn activate(guid: &str) -> AppResult<()> {
    util::run_hidden("powercfg", &["/setactive", guid]).map(|_| ())
}

fn set_both(guid: &str, sub: &str, setting: &str, value: &str) -> AppResult<()> {
    util::run_hidden("powercfg", &["/setacvalueindex", guid, sub, setting, value])?;
    util::run_hidden("powercfg", &["/setdcvalueindex", guid, sub, setting, value])?;
    Ok(())
}

/// Creates (or reuses) the FO scheme and returns its GUID.
/// `lock_cstates` additionally disables processor idle states (high heat; opt-in).
pub fn ensure_scheme(store: &RestoreStore, tweak: &str, lock_cstates: bool) -> AppResult<String> {
    let existing = store.find(|e| matches!(e, Entry::PowerScheme { .. }));
    let guid = match existing {
        Some(Entry::PowerScheme { created, .. }) if scheme_exists(&created) => created,
        _ => {
            let prior_active = active_scheme()?;
            let out = util::run_hidden("powercfg", &["/duplicatescheme", HIGH_PERFORMANCE])
                .or_else(|_| util::run_hidden("powercfg", &["/duplicatescheme", BALANCED]))?;
            let created = find_guid(&out).ok_or_else(|| AppError::Command("duplicatescheme returned no GUID".into()))?;
            store.record(tweak, Entry::PowerScheme { prior_active, created: created.clone() })?;
            let _ = util::run_hidden(
                "powercfg",
                &["/changename", &created, SCHEME_NAME, "Low-DPC competitive scheme managed by FreshOptimizer"],
            );
            created
        }
    };

    // Core parking off: keep 100% of cores unparked.
    set_both(&guid, "SUB_PROCESSOR", "CPMINCORES", "100")?;
    // Minimum processor state 100%: no frequency downclocking mid-match.
    set_both(&guid, "SUB_PROCESSOR", "PROCTHROTTLEMIN", "100")?;
    // PCIe link state power management off (avoids NIC/GPU wake latency).
    let _ = set_both(&guid, "SUB_PCIEXPRESS", "ASPM", "0");
    // USB selective suspend off (mouse/keyboard polling stability).
    let _ = set_both(&guid, "2a737441-1930-4402-8d77-b2bebba308a3", "48e6b7a6-50f5-4782-a5d4-53bb8f07e226", "0");
    // Processor idle disable (deep C-state lock) is opt-in only.
    set_both(&guid, "SUB_PROCESSOR", "IDLEDISABLE", if lock_cstates { "1" } else { "0" })?;
    Ok(guid)
}

pub fn managed_scheme(store: &RestoreStore) -> Option<String> {
    match store.find(|e| matches!(e, Entry::PowerScheme { .. })) {
        Some(Entry::PowerScheme { created, .. }) if scheme_exists(&created) => Some(created),
        _ => None,
    }
}

/// Rollback: re-activate the original scheme, then delete ours.
pub fn restore(prior_active: &str, created: &str) -> AppResult<()> {
    let target = if scheme_exists(prior_active) { prior_active } else { BALANCED };
    activate(target)?;
    if scheme_exists(created) {
        util::run_hidden("powercfg", &["/delete", created])?;
    }
    Ok(())
}
