use std::os::windows::process::CommandExt;
use std::process::Command;

use base64::Engine as _;

use crate::error::{AppError, AppResult};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Runs a console tool without flashing a window. Returns stdout on exit code 0.
pub fn run_hidden(program: &str, args: &[&str]) -> AppResult<String> {
    let out = Command::new(program)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| AppError::Command(format!("{program}: {e}")))?;
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    if out.status.success() {
        Ok(stdout)
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let msg = if stderr.trim().is_empty() { stdout.trim() } else { stderr.trim() };
        Err(AppError::Command(format!("{program} {}: {msg}", args.join(" "))))
    }
}

/// Runs a PowerShell script via -EncodedCommand so no quoting can break it.
pub fn powershell(script: &str) -> AppResult<String> {
    let wrapped = format!(
        "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;{script}"
    );
    let utf16: Vec<u8> = wrapped.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(utf16);
    run_hidden(
        "powershell.exe",
        &["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &encoded],
    )
}

/// Escapes a value for use inside a single-quoted PowerShell string literal.
pub fn ps_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

/// Extracts the first GUID (8-4-4-4-12) from free text, e.g. powercfg output.
pub fn find_guid(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let groups = [8usize, 4, 4, 4, 12];
    let total = 36;
    if bytes.len() < total {
        return None;
    }
    'outer: for start in 0..=bytes.len() - total {
        let mut i = start;
        for (gi, &len) in groups.iter().enumerate() {
            for _ in 0..len {
                if !bytes[i].is_ascii_hexdigit() {
                    continue 'outer;
                }
                i += 1;
            }
            if gi < groups.len() - 1 {
                if bytes[i] != b'-' {
                    continue 'outer;
                }
                i += 1;
            }
        }
        return Some(text[start..start + total].to_ascii_lowercase());
    }
    None
}

pub fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub fn wide_to_string(buf: &[u16]) -> String {
    let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    String::from_utf16_lossy(&buf[..end])
}
