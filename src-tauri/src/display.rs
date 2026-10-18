//! Monitor refresh rate: what each display runs at vs. the fastest mode it
//! supports at its current resolution, and switching to that mode.
//!
//! Windows often leaves high-refresh monitors at 60 Hz (new cable, driver
//! reinstall, new monitor). Changing it is a normal Windows display setting;
//! the UI asks the user to keep it within a few seconds or switches back.

use serde::Serialize;
use windows_sys::Win32::Graphics::Gdi::{
    ChangeDisplaySettingsExW, EnumDisplayDevicesW, EnumDisplaySettingsW, CDS_TEST, CDS_UPDATEREGISTRY, DEVMODEW, DISPLAY_DEVICEW,
    DISPLAY_DEVICE_ATTACHED_TO_DESKTOP, DISPLAY_DEVICE_PRIMARY_DEVICE, DISP_CHANGE_SUCCESSFUL, DM_DISPLAYFREQUENCY, DM_PELSHEIGHT, DM_PELSWIDTH,
    ENUM_CURRENT_SETTINGS,
};

use crate::error::{AppError, AppResult};
use crate::util::wide_to_string;

const DM_INTERLACED: u32 = 2;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayInfo {
    /// `\\.\DISPLAY1` etc. Passed back to `set_refresh`.
    pub device: String,
    pub monitor: String,
    pub primary: bool,
    pub width: u32,
    pub height: u32,
    pub current_hz: u32,
    /// Fastest rate Windows offers at the current resolution.
    pub max_hz: u32,
    /// Every rate offered at the current resolution, ascending.
    pub rates: Vec<u32>,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn devmode() -> DEVMODEW {
    let mut m = DEVMODEW::default();
    m.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
    m
}

fn current_mode(device: &[u16]) -> Option<DEVMODEW> {
    let mut m = devmode();
    // SAFETY: device is NUL-terminated, m.dmSize is set.
    (unsafe { EnumDisplaySettingsW(device.as_ptr(), ENUM_CURRENT_SETTINGS, &mut m) } != 0).then_some(m)
}

fn rates_at(device: &[u16], width: u32, height: u32, bits: u32) -> Vec<u32> {
    let mut rates = Vec::new();
    let mut i = 0u32;
    loop {
        let mut m = devmode();
        // SAFETY: as above; i walks the mode list until the call fails.
        if unsafe { EnumDisplaySettingsW(device.as_ptr(), i, &mut m) } == 0 {
            break;
        }
        i += 1;
        // SAFETY: dmDisplayFlags is the display-device member of the union.
        let interlaced = unsafe { m.Anonymous2.dmDisplayFlags } & DM_INTERLACED != 0;
        if m.dmPelsWidth == width && m.dmPelsHeight == height && m.dmBitsPerPel == bits && !interlaced && m.dmDisplayFrequency > 1 {
            rates.push(m.dmDisplayFrequency);
        }
    }
    rates.sort_unstable();
    rates.dedup();
    rates
}

pub fn list() -> Vec<DisplayInfo> {
    let mut out = Vec::new();
    for i in 0.. {
        let mut dd = DISPLAY_DEVICEW { cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
        // SAFETY: dd.cb set; enumeration ends when the call fails.
        if unsafe { EnumDisplayDevicesW(std::ptr::null(), i, &mut dd, 0) } == 0 {
            break;
        }
        if dd.StateFlags & DISPLAY_DEVICE_ATTACHED_TO_DESKTOP == 0 {
            continue;
        }
        let device = dd.DeviceName;
        let Some(cur) = current_mode(&device) else { continue };
        let mut mon = DISPLAY_DEVICEW { cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
        // SAFETY: device is the NUL-terminated adapter name from above.
        let monitor = if unsafe { EnumDisplayDevicesW(device.as_ptr(), 0, &mut mon, 0) } != 0 {
            wide_to_string(&mon.DeviceString)
        } else {
            String::new()
        };
        let rates = rates_at(&device, cur.dmPelsWidth, cur.dmPelsHeight, cur.dmBitsPerPel);
        out.push(DisplayInfo {
            device: wide_to_string(&device),
            monitor: if monitor.is_empty() || monitor.contains("Generic") {
                format!("Display {}", wide_to_string(&device).trim_start_matches(r"\.\DISPLAY"))
            } else {
                monitor
            },
            primary: dd.StateFlags & DISPLAY_DEVICE_PRIMARY_DEVICE != 0,
            width: cur.dmPelsWidth,
            height: cur.dmPelsHeight,
            current_hz: cur.dmDisplayFrequency,
            max_hz: rates.last().copied().unwrap_or(cur.dmDisplayFrequency).max(cur.dmDisplayFrequency),
            rates,
        });
    }
    out
}

/// Switches `device` to `hz` at its current resolution and saves it.
pub fn set_refresh(device: &str, hz: u32) -> AppResult<DisplayInfo> {
    let dev = wide(device);
    let cur = current_mode(&dev).ok_or_else(|| AppError::Unsupported("Display not found".into()))?;
    if !rates_at(&dev, cur.dmPelsWidth, cur.dmPelsHeight, cur.dmBitsPerPel).contains(&hz) {
        return Err(AppError::Unsupported(format!("{hz} Hz isn't offered at {}x{}", cur.dmPelsWidth, cur.dmPelsHeight)));
    }
    let mut m = devmode();
    m.dmPelsWidth = cur.dmPelsWidth;
    m.dmPelsHeight = cur.dmPelsHeight;
    m.dmDisplayFrequency = hz;
    m.dmFields = DM_PELSWIDTH | DM_PELSHEIGHT | DM_DISPLAYFREQUENCY;
    // SAFETY: dev NUL-terminated, m fully initialised; test first, then apply.
    unsafe {
        let r = ChangeDisplaySettingsExW(dev.as_ptr(), &m, std::ptr::null_mut(), CDS_TEST, std::ptr::null());
        if r != DISP_CHANGE_SUCCESSFUL {
            return Err(AppError::Command(format!("Windows rejected {hz} Hz (code {r})")));
        }
        let r = ChangeDisplaySettingsExW(dev.as_ptr(), &m, std::ptr::null_mut(), CDS_UPDATEREGISTRY, std::ptr::null());
        if r != DISP_CHANGE_SUCCESSFUL {
            return Err(AppError::Command(format!("Couldn't switch to {hz} Hz (code {r})")));
        }
    }
    list().into_iter().find(|d| d.device.eq_ignore_ascii_case(device)).ok_or_else(|| AppError::Other("Display disappeared".into()))
}
