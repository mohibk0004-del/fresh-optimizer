//! Pushes per-user input settings from the registry into the running session
//! (SystemParametersInfo), so mouse / menu / Sticky Keys changes apply now
//! instead of at the next sign-in. Called after a tweak and after Undo.

use windows_sys::Win32::UI::Accessibility::{SKF_HOTKEYACTIVE, STICKYKEYS};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPIF_SENDCHANGE, SPIF_UPDATEINIFILE, SPI_GETSTICKYKEYS, SPI_SETMENUSHOWDELAY, SPI_SETMOUSE,
    SPI_SETSTICKYKEYS,
};

use crate::registry::{self, Hive};

fn reg_num(path: &str, name: &str, default: i32) -> i32 {
    registry::read_string(Hive::CurrentUser, path, name).and_then(|s| s.trim().parse().ok()).unwrap_or(default)
}

/// Re-applies mouse acceleration, menu delay and the Sticky Keys shortcut from
/// whatever the registry says now.
pub fn refresh() {
    let flags = SPIF_UPDATEINIFILE | SPIF_SENDCHANGE;
    // "Enhance pointer precision": [threshold1, threshold2, acceleration].
    let mut mouse = [
        reg_num(r"Control Panel\Mouse", "MouseThreshold1", 6),
        reg_num(r"Control Panel\Mouse", "MouseThreshold2", 10),
        reg_num(r"Control Panel\Mouse", "MouseSpeed", 1),
    ];
    let delay = reg_num(r"Control Panel\Desktop", "MenuShowDelay", 400).max(0) as u32;
    let sticky_flags = reg_num(r"Control Panel\Accessibility\StickyKeys", "Flags", 510) as u32;

    // SAFETY: each call gets a correctly sized, initialised buffer.
    unsafe {
        SystemParametersInfoW(SPI_SETMOUSE, 0, mouse.as_mut_ptr().cast(), flags);
        SystemParametersInfoW(SPI_SETMENUSHOWDELAY, delay, std::ptr::null_mut(), flags);

        let mut sk = STICKYKEYS { cbSize: std::mem::size_of::<STICKYKEYS>() as u32, dwFlags: 0 };
        if SystemParametersInfoW(SPI_GETSTICKYKEYS, sk.cbSize, (&mut sk as *mut STICKYKEYS).cast(), 0) != 0 {
            if sticky_flags & SKF_HOTKEYACTIVE != 0 {
                sk.dwFlags |= SKF_HOTKEYACTIVE;
            } else {
                sk.dwFlags &= !SKF_HOTKEYACTIVE;
            }
            SystemParametersInfoW(SPI_SETSTICKYKEYS, sk.cbSize, (&mut sk as *mut STICKYKEYS).cast(), flags);
        }
    }
}
