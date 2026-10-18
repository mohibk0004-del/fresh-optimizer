//! Hardware profiler. The expensive WMI/CIM pass runs once (single PowerShell
//! invocation) and is cached; cheap live values (timer, HAGS) are read per call.

use serde::{Deserialize, Serialize};

use crate::cpu::{self, CpuTopology};
use crate::error::AppResult;
use crate::registry::{self, Hive};
use crate::timer::{self, TimerStatus};
use crate::util;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct CpuInfo {
    pub name: String,
    pub max_clock_mhz: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct GpuInfo {
    pub name: String,
    pub vram_bytes: u64,
    pub driver_version: String,
    /// "M-D-YYYY" from the driver package (registry DriverDate).
    pub driver_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RamInfo {
    pub total_bytes: u64,
    pub modules: u32,
    pub rated_mhz: u32,
    pub configured_mhz: u32,
    /// SMBIOS memory type (26 = DDR4, 34 = DDR5).
    pub smbios_type: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NicInfo {
    pub name: String,
    pub description: String,
    pub driver_version: String,
    pub link_speed: String,
    pub media: String,
    pub interface_guid: String,
    pub if_index: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct RawProfile {
    cpu: CpuInfo,
    gpus: Vec<GpuInfo>,
    ram: RamInfo,
    nic: Option<NicInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub cpu: CpuInfo,
    pub topology: CpuTopology,
    pub gpus: Vec<GpuInfo>,
    pub ram: RamInfo,
    pub ram_type: String,
    pub xmp_likely: bool,
    pub nic: Option<NicInfo>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub timer: TimerStatus,
    /// None when the GPU/driver does not expose HAGS.
    pub hags_enabled: Option<bool>,
    pub game_mode_enabled: bool,
    pub game_dvr_enabled: bool,
}

const PROFILE_SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = @()
Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}' |
  Where-Object { $_.PSChildName -match '^\d{4}$' } | ForEach-Object {
    $p = Get-ItemProperty $_.PSPath
    $mem = $p.'HardwareInformation.qwMemorySize'
    if (-not $mem) { $raw = $p.'HardwareInformation.MemorySize'; if ($raw -is [byte[]]) { $mem = [BitConverter]::ToUInt32($raw,0) } else { $mem = $raw } }
    if ($p.DriverDesc -and $p.DriverDesc -notmatch 'Basic Display|Remote|Virtual') {
      $gpus += [pscustomobject]@{ name = [string]$p.DriverDesc; vramBytes = [uint64]$mem; driverVersion = [string]$p.DriverVersion; driverDate = [string]$p.DriverDate }
    }
  }
$mods = @(Get-CimInstance Win32_PhysicalMemory)
$total = ($mods | Measure-Object -Property Capacity -Sum).Sum
$first = $mods | Select-Object -First 1
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Sort-Object { $_.RouteMetric + $_.InterfaceMetric } | Select-Object -First 1
$nic = $null
if ($route) {
  $a = Get-NetAdapter -InterfaceIndex $route.ifIndex
  if ($a) {
    $nic = [pscustomobject]@{
      name = [string]$a.Name; description = [string]$a.InterfaceDescription; driverVersion = [string]$a.DriverVersion
      linkSpeed = [string]$a.LinkSpeed; media = [string]$a.PhysicalMediaType; interfaceGuid = [string]$a.InterfaceGuid
      ifIndex = [uint32]$a.ifIndex
    }
  }
}
[pscustomobject]@{
  cpu = [pscustomobject]@{ name = ([string]$cpu.Name).Trim(); maxClockMhz = [uint32]$cpu.MaxClockSpeed }
  gpus = $gpus
  ram = [pscustomobject]@{
    totalBytes = [uint64]$total; modules = [uint32]$mods.Count; ratedMhz = [uint32]$first.Speed
    configuredMhz = [uint32]$first.ConfiguredClockSpeed; smbiosType = [uint32]$first.SMBIOSMemoryType
  }
  nic = $nic
} | ConvertTo-Json -Depth 5 -Compress
"#;

pub fn profile() -> AppResult<HardwareProfile> {
    let raw: RawProfile = match util::powershell(PROFILE_SCRIPT) {
        Ok(out) => serde_json::from_str(out.trim()).unwrap_or_default(),
        // Degrade gracefully: native topology still works without PowerShell/WMI.
        Err(_) => RawProfile::default(),
    };

    let (ram_type, jedec_ceiling) = match raw.ram.smbios_type {
        26 => ("DDR4", 3200),
        34 => ("DDR5", 5600),
        24 => ("DDR3", 1600),
        _ => ("RAM", u32::MAX),
    };
    // XMP/EXPO heuristic: running above the module's SPD JEDEC speed, or above the
    // JEDEC ceiling for its generation, means a profile is loaded.
    let xmp_likely = raw.ram.configured_mhz > 0
        && (raw.ram.configured_mhz > raw.ram.rated_mhz || raw.ram.configured_mhz > jedec_ceiling);

    Ok(HardwareProfile {
        cpu: raw.cpu,
        topology: cpu::topology(),
        gpus: raw.gpus,
        ram: raw.ram,
        ram_type: ram_type.into(),
        xmp_likely,
        nic: raw.nic,
    })
}

pub fn live_status() -> LiveStatus {
    let hags = registry::read_dword(Hive::LocalMachine, r"SYSTEM\CurrentControlSet\Control\GraphicsDrivers", "HwSchMode")
        .map(|v| v == 2);
    let game_mode = registry::read_dword(Hive::CurrentUser, r"Software\Microsoft\GameBar", "AutoGameModeEnabled")
        .map(|v| v != 0)
        .unwrap_or(true); // Windows default is on when the value is absent.
    let dvr = registry::read_dword(Hive::CurrentUser, r"System\GameConfigStore", "GameDVR_Enabled")
        .map(|v| v != 0)
        .unwrap_or(true);
    LiveStatus { timer: timer::status(), hags_enabled: hags, game_mode_enabled: game_mode, game_dvr_enabled: dvr }
}
