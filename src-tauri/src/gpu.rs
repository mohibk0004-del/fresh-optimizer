//! NVIDIA GPU temperature, clocks, power and throttling through NVML, NVIDIA's
//! own read-only monitoring library that ships with the driver. Nothing about the
//! GPU is changed. Other vendors have no equivalent public API, so they get `None`.
//!
//! Loaded at runtime from System32 by full path (never from the search path), so
//! the app runs fine without an NVIDIA card.

use std::ffi::c_void;
use std::sync::Mutex;

use serde::Serialize;
use windows_sys::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32};

type Device = *mut c_void;
type Ret = u32;

#[repr(C)]
#[derive(Default)]
struct Utilization {
    gpu: u32,
    memory: u32,
}

struct Nvml {
    temperature: unsafe extern "C" fn(Device, u32, *mut u32) -> Ret,
    clock: unsafe extern "C" fn(Device, u32, *mut u32) -> Ret,
    power: unsafe extern "C" fn(Device, *mut u32) -> Ret,
    utilization: unsafe extern "C" fn(Device, *mut Utilization) -> Ret,
    reasons: Option<unsafe extern "C" fn(Device, *mut u64) -> Ret>,
    device: usize,
    name: String,
}

// SAFETY: NVML is thread-safe; the device handle is an opaque driver pointer.
unsafe impl Send for Nvml {}

static NVML: Mutex<Option<Option<Nvml>>> = Mutex::new(None);
static SESSION: Mutex<Option<Acc>> = Mutex::new(None);

const SW_POWER_CAP: u64 = 0x4;
const HW_SLOWDOWN: u64 = 0x8;
const SW_THERMAL: u64 = 0x20;
const HW_THERMAL: u64 = 0x40;
const HW_POWER_BRAKE: u64 = 0x80;

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

fn load() -> Option<Nvml> {
    // SAFETY: library loaded from System32 only; every symbol is checked before use
    // and transmuted to its documented NVML signature.
    unsafe {
        let lib = LoadLibraryExW(wide("nvml.dll").as_ptr(), std::ptr::null_mut(), LOAD_LIBRARY_SEARCH_SYSTEM32);
        if lib.is_null() {
            return None;
        }
        macro_rules! sym {
            ($name:literal) => {
                GetProcAddress(lib, concat!($name, "\0").as_ptr())
            };
        }
        let init: unsafe extern "C" fn() -> Ret = std::mem::transmute(sym!("nvmlInit_v2")?);
        if init() != 0 {
            return None;
        }
        let by_index: unsafe extern "C" fn(u32, *mut Device) -> Ret = std::mem::transmute(sym!("nvmlDeviceGetHandleByIndex_v2")?);
        let mut dev: Device = std::ptr::null_mut();
        if by_index(0, &mut dev) != 0 {
            return None;
        }
        let name_fn: unsafe extern "C" fn(Device, *mut u8, u32) -> Ret = std::mem::transmute(sym!("nvmlDeviceGetName")?);
        let mut buf = [0u8; 96];
        let name = if name_fn(dev, buf.as_mut_ptr(), buf.len() as u32) == 0 {
            String::from_utf8_lossy(&buf[..buf.iter().position(|&b| b == 0).unwrap_or(buf.len())]).into_owned()
        } else {
            "NVIDIA GPU".into()
        };
        let reasons = sym!("nvmlDeviceGetCurrentClocksEventReasons")
            .or_else(|| sym!("nvmlDeviceGetCurrentClocksThrottleReasons"))
            .map(|f| std::mem::transmute::<_, unsafe extern "C" fn(Device, *mut u64) -> Ret>(f));
        Some(Nvml {
            temperature: std::mem::transmute(sym!("nvmlDeviceGetTemperature")?),
            clock: std::mem::transmute(sym!("nvmlDeviceGetClockInfo")?),
            power: std::mem::transmute(sym!("nvmlDeviceGetPowerUsage")?),
            utilization: std::mem::transmute(sym!("nvmlDeviceGetUtilizationRates")?),
            reasons,
            device: dev as usize,
            name,
        })
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuNow {
    pub name: String,
    pub temp_c: u32,
    pub clock_mhz: u32,
    pub power_w: f64,
    pub load_pct: u32,
    pub thermal_limited: bool,
    pub power_limited: bool,
}

/// One reading, or `None` without an NVIDIA GPU.
pub fn now() -> Option<GpuNow> {
    let mut guard = NVML.lock().unwrap_or_else(|p| p.into_inner());
    let nv = guard.get_or_insert_with(load).as_ref()?;
    let dev = nv.device as Device;
    // SAFETY: valid handle from nvmlDeviceGetHandleByIndex; out-params are locals.
    unsafe {
        let (mut t, mut c, mut p, mut u, mut r) = (0u32, 0u32, 0u32, Utilization::default(), 0u64);
        if (nv.temperature)(dev, 0, &mut t) != 0 {
            return None;
        }
        let _ = (nv.clock)(dev, 0, &mut c);
        let _ = (nv.power)(dev, &mut p);
        let _ = (nv.utilization)(dev, &mut u);
        if let Some(f) = nv.reasons {
            let _ = f(dev, &mut r);
        }
        Some(GpuNow {
            name: nv.name.clone(),
            temp_c: t,
            clock_mhz: c,
            power_w: (p as f64 / 100.0).round() / 10.0,
            load_pct: u.gpu,
            thermal_limited: r & (SW_THERMAL | HW_THERMAL | HW_SLOWDOWN) != 0,
            power_limited: r & (SW_POWER_CAP | HW_POWER_BRAKE) != 0,
        })
    }
}

/// What the GPU did over one match.
#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuSummary {
    pub name: String,
    pub max_temp_c: u32,
    pub avg_temp_c: f64,
    pub avg_clock_mhz: f64,
    pub avg_load_pct: f64,
    /// Share of samples (0..100) where the driver reported slowing down for heat.
    pub thermal_pct: f64,
    /// ... for hitting the power limit. Common and normal under full load.
    pub power_pct: f64,
    pub samples: u32,
}

#[derive(Default)]
struct Acc {
    name: String,
    n: u32,
    max_t: u32,
    sum_t: f64,
    sum_c: f64,
    sum_l: f64,
    thermal: u32,
    power: u32,
}

pub fn session_start() {
    *SESSION.lock().unwrap_or_else(|p| p.into_inner()) = Some(Acc::default());
}

/// Called every engine tick during a match.
pub fn session_sample() -> Option<GpuNow> {
    let g = now()?;
    if let Some(a) = SESSION.lock().unwrap_or_else(|p| p.into_inner()).as_mut() {
        a.name.clone_from(&g.name);
        a.n += 1;
        a.max_t = a.max_t.max(g.temp_c);
        a.sum_t += g.temp_c as f64;
        a.sum_c += g.clock_mhz as f64;
        a.sum_l += g.load_pct as f64;
        a.thermal += g.thermal_limited as u32;
        a.power += g.power_limited as u32;
    }
    Some(g)
}

pub fn session_end() -> Option<GpuSummary> {
    let a = SESSION.lock().unwrap_or_else(|p| p.into_inner()).take()?;
    summarize(&a)
}

fn summarize(a: &Acc) -> Option<GpuSummary> {
    if a.n == 0 {
        return None;
    }
    let n = a.n as f64;
    let r1 = |v: f64| (v * 10.0).round() / 10.0;
    Some(GpuSummary {
        name: a.name.clone(),
        max_temp_c: a.max_t,
        avg_temp_c: r1(a.sum_t / n),
        avg_clock_mhz: r1(a.sum_c / n),
        avg_load_pct: r1(a.sum_l / n),
        thermal_pct: r1(a.thermal as f64 / n * 100.0),
        power_pct: r1(a.power as f64 / n * 100.0),
        samples: a.n,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarizes_samples() {
        let a = Acc { name: "x".into(), n: 4, max_t: 80, sum_t: 300.0, sum_c: 7200.0, sum_l: 360.0, thermal: 1, power: 2 };
        let s = summarize(&a).unwrap();
        assert_eq!(s.avg_temp_c, 75.0);
        assert_eq!(s.thermal_pct, 25.0);
        assert_eq!(s.power_pct, 50.0);
        assert!(summarize(&Acc::default()).is_none());
    }
}
