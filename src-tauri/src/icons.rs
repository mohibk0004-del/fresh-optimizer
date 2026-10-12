//! Extracts a game's own icon from its .exe and returns it as a PNG data URL.
//! Read-only: uses PrivateExtractIconsW on the file, never touches the process.

use std::collections::HashMap;
use std::sync::Mutex;

use base64::Engine as _;
use windows_sys::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, PrivateExtractIconsW, HICON, ICONINFO};

static CACHE: Mutex<Option<HashMap<String, Option<String>>>> = Mutex::new(None);

/// Largest icon in the file at up to `size` px, as `data:image/png;base64,...`.
pub fn exe_icon(path: &str, size: i32) -> Option<String> {
    let key = format!("{size}|{}", path.to_ascii_lowercase());
    if let Some(hit) = CACHE.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert_with(HashMap::new).get(&key) {
        return hit.clone();
    }
    let result = extract(path, size);
    CACHE.lock().unwrap_or_else(|p| p.into_inner()).get_or_insert_with(HashMap::new).insert(key, result.clone());
    result
}

fn extract(path: &str, size: i32) -> Option<String> {
    let wide: Vec<u16> = path.encode_utf16().chain(std::iter::once(0)).collect();
    let mut icon: HICON = std::ptr::null_mut();
    let mut id = 0u32;
    // SAFETY: valid NUL-terminated path, one output slot.
    let n = unsafe { PrivateExtractIconsW(wide.as_ptr(), 0, size, size, &mut icon, &mut id, 1, 0) };
    if n == 0 || n == u32::MAX || icon.is_null() {
        return None;
    }
    let png = unsafe { icon_to_png(icon) };
    // SAFETY: icon came from PrivateExtractIconsW.
    unsafe { DestroyIcon(icon) };
    png.map(|bytes| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}

/// Reads the icon's colour (and mask, for icons without alpha) as RGBA and encodes PNG.
unsafe fn icon_to_png(icon: HICON) -> Option<Vec<u8>> {
    let mut info: ICONINFO = std::mem::zeroed();
    if GetIconInfo(icon, &mut info) == 0 || info.hbmColor.is_null() {
        if !info.hbmMask.is_null() {
            DeleteObject(info.hbmMask);
        }
        return None;
    }
    let mut bm: BITMAP = std::mem::zeroed();
    GetObjectW(info.hbmColor, std::mem::size_of::<BITMAP>() as i32, (&mut bm as *mut BITMAP).cast());
    let (w, h) = (bm.bmWidth, bm.bmHeight);

    let read = |bmp| -> Option<Vec<u8>> {
        let dc = CreateCompatibleDC(std::ptr::null_mut());
        let mut bi: BITMAPINFO = std::mem::zeroed();
        bi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // top-down
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            ..std::mem::zeroed()
        };
        let mut buf = vec![0u8; (w * h * 4) as usize];
        let ok = GetDIBits(dc, bmp, 0, h as u32, buf.as_mut_ptr().cast(), &mut bi, DIB_RGB_COLORS);
        DeleteDC(dc);
        (ok != 0).then_some(buf)
    };

    let color = read(info.hbmColor);
    let mask = if info.hbmMask.is_null() { None } else { read(info.hbmMask) };
    DeleteObject(info.hbmColor);
    if !info.hbmMask.is_null() {
        DeleteObject(info.hbmMask);
    }
    let mut px = color?;

    // BGRA -> RGBA. Old-style icons have no alpha: derive it from the AND mask.
    let has_alpha = px.chunks(4).any(|c| c[3] != 0);
    for (i, c) in px.chunks_mut(4).enumerate() {
        c.swap(0, 2);
        if !has_alpha {
            let transparent = mask.as_ref().map(|m| m[i * 4] != 0).unwrap_or(false);
            c[3] = if transparent { 0 } else { 255 };
        }
    }

    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().ok()?;
        writer.write_image_data(&px).ok()?;
    }
    Some(out)
}
