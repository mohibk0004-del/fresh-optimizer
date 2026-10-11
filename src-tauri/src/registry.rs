//! Registry manager. Every write goes through `set_*_tracked`, which snapshots the
//! baseline value into the restore point *before* touching the key.

use serde::{Deserialize, Serialize};
use winreg::enums::*;
use winreg::{RegKey, RegValue};

use crate::error::{AppError, AppResult};
use crate::restore::{Entry, RestoreStore};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Hive {
    #[serde(rename = "HKLM")]
    LocalMachine,
    #[serde(rename = "HKCU")]
    CurrentUser,
}

impl Hive {
    fn root(self) -> RegKey {
        match self {
            Hive::LocalMachine => RegKey::predef(HKEY_LOCAL_MACHINE),
            Hive::CurrentUser => RegKey::predef(HKEY_CURRENT_USER),
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Hive::LocalMachine => "HKLM",
            Hive::CurrentUser => "HKCU",
        }
    }
}

/// Raw registry value as stored in RestorePoint.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredValue {
    pub vtype: u32,
    pub data: Vec<u8>,
}

fn regtype_from_u32(v: u32) -> RegType {
    match v {
        1 => REG_SZ,
        2 => REG_EXPAND_SZ,
        3 => REG_BINARY,
        4 => REG_DWORD,
        5 => REG_DWORD_BIG_ENDIAN,
        6 => REG_LINK,
        7 => REG_MULTI_SZ,
        8 => REG_RESOURCE_LIST,
        9 => REG_FULL_RESOURCE_DESCRIPTOR,
        10 => REG_RESOURCE_REQUIREMENTS_LIST,
        11 => REG_QWORD,
        _ => REG_NONE,
    }
}

impl From<RegValue> for StoredValue {
    fn from(v: RegValue) -> Self {
        StoredValue { vtype: v.vtype as u32, data: v.bytes.to_vec() }
    }
}

impl StoredValue {
    fn to_reg(&self) -> RegValue {
        RegValue { vtype: regtype_from_u32(self.vtype), bytes: self.data.clone() }
    }
}

pub fn read_raw(hive: Hive, path: &str, name: &str) -> Option<StoredValue> {
    let key = hive.root().open_subkey_with_flags(path, KEY_READ).ok()?;
    key.get_raw_value(name).ok().map(StoredValue::from)
}

pub fn read_dword(hive: Hive, path: &str, name: &str) -> Option<u32> {
    hive.root().open_subkey_with_flags(path, KEY_READ).ok()?.get_value::<u32, _>(name).ok()
}

pub fn read_string(hive: Hive, path: &str, name: &str) -> Option<String> {
    hive.root().open_subkey_with_flags(path, KEY_READ).ok()?.get_value::<String, _>(name).ok()
}

pub fn key_exists(hive: Hive, path: &str) -> bool {
    hive.root().open_subkey_with_flags(path, KEY_READ).is_ok()
}

/// Topmost ancestor of `path` that does not yet exist (what `create_subkey` will create).
fn first_missing_ancestor(hive: Hive, path: &str) -> Option<String> {
    let parts: Vec<&str> = path.split('\\').filter(|p| !p.is_empty()).collect();
    for i in 1..=parts.len() {
        let candidate = parts[..i].join("\\");
        if !key_exists(hive, &candidate) {
            return Some(candidate);
        }
    }
    None
}

fn snapshot(store: &RestoreStore, tweak: &str, hive: Hive, path: &str, name: &str) -> AppResult<()> {
    let prior = read_raw(hive, path, name);
    let created_from = first_missing_ancestor(hive, path);
    store.record(
        tweak,
        Entry::Registry {
            hive,
            path: path.to_string(),
            name: name.to_string(),
            prior,
            created_from,
        },
    )
}

fn write(hive: Hive, path: &str, name: &str, value: &RegValue) -> AppResult<()> {
    let ctx = format!("{}\\{}\\{}", hive.label(), path, name);
    let (key, _) = hive
        .root()
        .create_subkey_with_flags(path, KEY_READ | KEY_WRITE)
        .map_err(|e| AppError::registry(&ctx, e))?;
    key.set_raw_value(name, value).map_err(|e| AppError::registry(&ctx, e))
}

pub fn set_dword_tracked(store: &RestoreStore, tweak: &str, hive: Hive, path: &str, name: &str, value: u32) -> AppResult<()> {
    snapshot(store, tweak, hive, path, name)?;
    let rv = RegValue { vtype: REG_DWORD, bytes: value.to_le_bytes().to_vec().into() };
    write(hive, path, name, &rv)
}

pub fn set_string_tracked(store: &RestoreStore, tweak: &str, hive: Hive, path: &str, name: &str, value: &str) -> AppResult<()> {
    snapshot(store, tweak, hive, path, name)?;
    let mut bytes: Vec<u8> = value.encode_utf16().chain(std::iter::once(0)).flat_map(|u| u.to_le_bytes()).collect();
    bytes.shrink_to_fit();
    let rv = RegValue { vtype: REG_SZ, bytes: bytes.into() };
    write(hive, path, name, &rv)
}

pub fn set_binary_tracked(store: &RestoreStore, tweak: &str, hive: Hive, path: &str, name: &str, data: &[u8]) -> AppResult<()> {
    snapshot(store, tweak, hive, path, name)?;
    let rv = RegValue { vtype: REG_BINARY, bytes: data.to_vec() };
    write(hive, path, name, &rv)
}

/// Restores one value to its baseline. Missing baseline => value is deleted and any
/// keys this app created are removed again, but only while they are empty.
pub fn restore_value(hive: Hive, path: &str, name: &str, prior: &Option<StoredValue>, created_from: &Option<String>) -> AppResult<()> {
    let ctx = format!("{}\\{}\\{}", hive.label(), path, name);
    match prior {
        Some(v) => write(hive, path, name, &v.to_reg()),
        None => {
            if let Ok(key) = hive.root().open_subkey_with_flags(path, KEY_READ | KEY_WRITE) {
                match key.delete_value(name) {
                    Ok(()) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                    Err(e) => return Err(AppError::registry(&ctx, e)),
                }
            }
            if let Some(top) = created_from {
                prune_empty_keys(hive, path, top);
            }
            Ok(())
        }
    }
}

fn prune_empty_keys(hive: Hive, path: &str, top: &str) {
    let mut current = path.to_string();
    loop {
        let empty = hive
            .root()
            .open_subkey_with_flags(&current, KEY_READ)
            .map(|k| k.query_info().map(|i| i.sub_keys == 0 && i.values == 0).unwrap_or(false))
            .unwrap_or(false);
        if !empty {
            return;
        }
        let Some((parent, leaf)) = current.rsplit_once('\\') else { return };
        if let Ok(p) = hive.root().open_subkey_with_flags(parent, KEY_READ | KEY_WRITE) {
            let _ = p.delete_subkey(leaf);
        }
        if current.eq_ignore_ascii_case(top) {
            return;
        }
        current = parent.to_string();
    }
}
