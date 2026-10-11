//! CPU topology via GetLogicalProcessorInformationEx: core/thread counts and
//! hybrid (P-core / E-core) detection from each core's EfficiencyClass.

use serde::Serialize;
use windows_sys::Win32::System::SystemInformation::{GetLogicalProcessorInformationEx, RelationProcessorCore};

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuTopology {
    pub physical_cores: u32,
    pub logical_threads: u32,
    pub hybrid: bool,
    pub p_cores: u32,
    pub e_cores: u32,
    /// Affinity mask (processor group 0) covering only performance cores.
    pub p_core_mask: u64,
    /// Affinity mask (processor group 0) covering every logical processor.
    pub full_mask: u64,
}

struct Core {
    efficiency: u8,
    group: u16,
    mask: u64,
}

pub fn topology() -> CpuTopology {
    let cores = read_cores();
    if cores.is_empty() {
        return CpuTopology::default();
    }
    let max_eff = cores.iter().map(|c| c.efficiency).max().unwrap_or(0);
    let min_eff = cores.iter().map(|c| c.efficiency).min().unwrap_or(0);
    let hybrid = max_eff != min_eff;

    let mut t = CpuTopology { physical_cores: cores.len() as u32, hybrid, ..Default::default() };
    for c in &cores {
        t.logical_threads += c.mask.count_ones();
        let is_p = !hybrid || c.efficiency == max_eff;
        if is_p {
            t.p_cores += 1;
        } else {
            t.e_cores += 1;
        }
        if c.group == 0 {
            t.full_mask |= c.mask;
            if is_p {
                t.p_core_mask |= c.mask;
            }
        }
    }
    t
}

fn read_cores() -> Vec<Core> {
    let mut len: u32 = 0;
    // SAFETY: size query with a null buffer is the documented calling pattern.
    unsafe { GetLogicalProcessorInformationEx(RelationProcessorCore, std::ptr::null_mut(), &mut len) };
    if len == 0 {
        return Vec::new();
    }
    let mut buf = vec![0u8; len as usize];
    // SAFETY: buffer is `len` bytes as requested by the previous call.
    let ok = unsafe { GetLogicalProcessorInformationEx(RelationProcessorCore, buf.as_mut_ptr().cast(), &mut len) };
    if ok == 0 {
        return Vec::new();
    }

    // Layout (x64): Relationship u32 | Size u32 | PROCESSOR_RELATIONSHIP {
    //   Flags u8, EfficiencyClass u8, Reserved [u8;20], GroupCount u16, GroupMask[] }
    // GROUP_AFFINITY { Mask usize, Group u16, Reserved [u16;3] }
    let rd_u32 = |o: usize| u32::from_le_bytes(buf[o..o + 4].try_into().unwrap());
    let rd_u16 = |o: usize| u16::from_le_bytes(buf[o..o + 2].try_into().unwrap());
    let rd_u64 = |o: usize| u64::from_le_bytes(buf[o..o + 8].try_into().unwrap());

    let mut cores = Vec::new();
    let mut off = 0usize;
    let total = len as usize;
    while off + 8 <= total {
        let size = rd_u32(off + 4) as usize;
        if size == 0 || off + size > total {
            break;
        }
        if rd_u32(off) == RelationProcessorCore as u32 && off + 32 + 16 <= total {
            // A core always lives in exactly one processor group, so GroupMask[0] suffices.
            let efficiency = buf[off + 9];
            let ga = off + 32;
            cores.push(Core { efficiency, mask: rd_u64(ga), group: rd_u16(ga + 8) });
        }
        off += size;
    }
    cores
}
