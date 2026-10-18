//! Finds the server a running game is connected to, so its real ping can be shown.
//!
//! Games talk to their servers over UDP, and Windows' connection tables don't
//! record UDP remote addresses. Windows' own network event log does: the
//! Microsoft-Windows-Kernel-Network ETW provider reports every packet with the
//! process ID that sent or received it (Resource Monitor reads the same data).
//! We count packets per remote address for the game's process IDs only.
//!
//! Anti-cheat safety: this never opens, reads or signals the game process. It only
//! listens to a system-wide event log. Needs administrator rights (we have them).

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, UdpSocket};
use std::sync::{Mutex, RwLock};
use std::time::{Duration, Instant};

use serde::Serialize;
use windows_sys::core::GUID;
use windows_sys::Win32::System::Diagnostics::Etw::{
    CloseTrace, ControlTraceW, EnableTraceEx2, OpenTraceW, ProcessTrace, StartTraceW, CONTROLTRACE_HANDLE, EVENT_CONTROL_CODE_ENABLE_PROVIDER,
    EVENT_RECORD, EVENT_TRACE_CONTROL_STOP, EVENT_TRACE_LOGFILEW, EVENT_TRACE_PROPERTIES, EVENT_TRACE_REAL_TIME_MODE, PROCESSTRACE_HANDLE,
    PROCESS_TRACE_MODE_EVENT_RECORD, PROCESS_TRACE_MODE_REAL_TIME, WNODE_FLAG_TRACED_GUID,
};

const SESSION: &str = "FreshOptimizer-Net";
/// Microsoft-Windows-Kernel-Network.
const PROVIDER: GUID = GUID::from_u128(0x7dd42a49_5329_4832_8dfd_43d979153a88);
/// KERNEL_NETWORK_KEYWORD_IPV4 | KERNEL_NETWORK_KEYWORD_IPV6.
const KEYWORDS: u64 = 0x10 | 0x20;
const SESSION_GUID: GUID = GUID::from_u128(0x6f1d2c9a_8a35_4c5e_9b7e_3f0b8e2a41c7);
/// Web, DNS and similar: launcher/API traffic, not the match server.
const IGNORED_PORTS: &[u16] = &[53, 80, 443, 5353, 1900];
/// Count over this window when choosing the busiest endpoint.
const WINDOW: Duration = Duration::from_secs(6);

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Packet {
    pub pid: u32,
    pub size: u32,
    pub udp: bool,
    pub dst: IpAddr,
    pub src: IpAddr,
    pub dport: u16,
    pub sport: u16,
    pub send: bool,
}

/// Decodes one Kernel-Network event payload. Layout (all versions):
/// PID u32, size u32, daddr, saddr (4 or 16 bytes), dport u16, sport u16 (network order).
pub fn parse(event_id: u16, data: &[u8]) -> Option<Packet> {
    let (udp, v6, send) = match event_id {
        10 => (false, false, true),
        11 => (false, false, false),
        26 => (false, true, true),
        27 => (false, true, false),
        42 => (true, false, true),
        43 => (true, false, false),
        58 => (true, true, true),
        59 => (true, true, false),
        _ => return None,
    };
    let alen = if v6 { 16 } else { 4 };
    if data.len() < 8 + alen * 2 + 4 {
        return None;
    }
    let u32le = |o: usize| u32::from_le_bytes(data[o..o + 4].try_into().unwrap());
    let addr = |o: usize| -> IpAddr {
        if v6 {
            IpAddr::V6(Ipv6Addr::from(<[u8; 16]>::try_from(&data[o..o + 16]).unwrap()))
        } else {
            IpAddr::V4(Ipv4Addr::new(data[o], data[o + 1], data[o + 2], data[o + 3]))
        }
    };
    let p = 8 + alen * 2;
    Some(Packet {
        pid: u32le(0),
        size: u32le(4),
        udp,
        dst: addr(8),
        src: addr(8 + alen),
        dport: u16::from_be_bytes([data[p], data[p + 1]]),
        sport: u16::from_be_bytes([data[p + 2], data[p + 3]]),
        send,
    })
}

/// The far end of a packet: whichever address isn't this PC.
fn remote(p: &Packet, local: &HashSet<IpAddr>) -> (IpAddr, u16) {
    match (local.contains(&p.dst), local.contains(&p.src)) {
        (false, true) => (p.dst, p.dport),
        (true, false) => (p.src, p.sport),
        // Unknown (VPN, new interface): sends go to dst, receives come from src.
        _ if p.send => (p.dst, p.dport),
        _ => (p.src, p.sport),
    }
}

#[derive(Default)]
struct Tally {
    cur: HashMap<(IpAddr, u16, bool), u64>,
    prev: HashMap<(IpAddr, u16, bool), u64>,
    rotated: Option<Instant>,
}

static PIDS: RwLock<Option<HashSet<u32>>> = RwLock::new(None);
static LOCAL: RwLock<Option<HashSet<IpAddr>>> = RwLock::new(None);
static TALLY: Mutex<Option<Tally>> = Mutex::new(None);
static RUNNING: Mutex<Option<(u64, u64)>> = Mutex::new(None);

pub fn record(p: &Packet) {
    let tracked = PIDS.read().ok().and_then(|g| g.as_ref().map(|s| s.contains(&p.pid))).unwrap_or(false);
    if !tracked {
        return;
    }
    let local = LOCAL.read().ok().and_then(|g| g.clone()).unwrap_or_default();
    let (ip, port) = remote(p, &local);
    if ip.is_loopback() || ip.is_unspecified() || IGNORED_PORTS.contains(&port) {
        return;
    }
    let mut g = TALLY.lock().unwrap_or_else(|e| e.into_inner());
    *g.get_or_insert_with(Tally::default).cur.entry((ip, port, p.udp)).or_default() += 1;
}

unsafe extern "system" fn on_event(rec: *mut EVENT_RECORD) {
    let r = &*rec;
    if r.UserData.is_null() || r.UserDataLength == 0 {
        return;
    }
    let data = std::slice::from_raw_parts(r.UserData as *const u8, r.UserDataLength as usize);
    if let Some(p) = parse(r.EventHeader.EventDescriptor.Id, data) {
        record(&p);
    }
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Buffer holding EVENT_TRACE_PROPERTIES followed by the session name.
fn properties() -> Vec<u64> {
    let size = std::mem::size_of::<EVENT_TRACE_PROPERTIES>() + 1024;
    let mut buf = vec![0u64; size / 8 + 1];
    // SAFETY: buf is zeroed, 8-byte aligned and larger than the struct.
    let p = unsafe { &mut *(buf.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES) };
    p.Wnode.BufferSize = size as u32;
    p.Wnode.Flags = WNODE_FLAG_TRACED_GUID;
    p.Wnode.ClientContext = 1;
    p.Wnode.Guid = SESSION_GUID;
    p.LogFileMode = EVENT_TRACE_REAL_TIME_MODE;
    p.FlushTimer = 1;
    p.LoggerNameOffset = std::mem::size_of::<EVENT_TRACE_PROPERTIES>() as u32;
    buf
}

fn stop_session() {
    let mut props = properties();
    // SAFETY: valid properties buffer; stopping a missing session just fails.
    unsafe {
        ControlTraceW(CONTROLTRACE_HANDLE { Value: 0 }, wide(SESSION).as_ptr(), props.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES, EVENT_TRACE_CONTROL_STOP);
    }
}

/// The address Windows would use to reach the internet (one per IP family).
fn local_addresses() -> HashSet<IpAddr> {
    let mut set: HashSet<IpAddr> = [IpAddr::V4(Ipv4Addr::LOCALHOST), IpAddr::V6(Ipv6Addr::LOCALHOST)].into();
    for (bind, target) in [("0.0.0.0:0", "1.1.1.1:53"), ("[::]:0", "[2606:4700:4700::1111]:53")] {
        // connect() on UDP sends nothing; it only picks the route.
        if let Ok(s) = UdpSocket::bind(bind) {
            if s.connect(target).is_ok() {
                if let Ok(SocketAddr::V4(a)) = s.local_addr() {
                    set.insert(IpAddr::V4(*a.ip()));
                } else if let Ok(SocketAddr::V6(a)) = s.local_addr() {
                    set.insert(IpAddr::V6(*a.ip()));
                }
            }
        }
    }
    set
}

/// Starts watching (if not already) and sets which processes are the game.
pub fn watch(pids: HashSet<u32>) -> Result<(), String> {
    *PIDS.write().unwrap_or_else(|e| e.into_inner()) = Some(pids);
    let mut running = RUNNING.lock().unwrap_or_else(|e| e.into_inner());
    if running.is_some() {
        return Ok(());
    }
    *LOCAL.write().unwrap_or_else(|e| e.into_inner()) = Some(local_addresses());
    *TALLY.lock().unwrap_or_else(|e| e.into_inner()) = Some(Tally::default());
    stop_session();
    let mut props = properties();
    let mut session = CONTROLTRACE_HANDLE { Value: 0 };
    let name = wide(SESSION);
    // SAFETY: documented ETW real-time setup; buffers outlive the calls that use them.
    unsafe {
        let r = StartTraceW(&mut session, name.as_ptr(), props.as_mut_ptr() as *mut EVENT_TRACE_PROPERTIES);
        if r != 0 {
            return Err(format!("couldn't start network event log (error {r})"));
        }
        let r = EnableTraceEx2(session, &PROVIDER, EVENT_CONTROL_CODE_ENABLE_PROVIDER, 4, KEYWORDS, 0, 0, std::ptr::null());
        if r != 0 {
            stop_session();
            return Err(format!("couldn't enable network events (error {r})"));
        }
        let mut name_buf = wide(SESSION);
        let mut log: EVENT_TRACE_LOGFILEW = std::mem::zeroed();
        log.LoggerName = name_buf.as_mut_ptr();
        log.Anonymous1.ProcessTraceMode = PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD;
        log.Anonymous2.EventRecordCallback = Some(on_event);
        let trace = OpenTraceW(&mut log);
        if trace.Value == u64::MAX {
            stop_session();
            return Err("couldn't open network event log".into());
        }
        let handle = trace.Value;
        std::thread::Builder::new()
            .name("fo-netwatch".into())
            .spawn(move || {
                let h = PROCESSTRACE_HANDLE { Value: handle };
                ProcessTrace(&h, 1, std::ptr::null(), std::ptr::null());
            })
            .map_err(|e| e.to_string())?;
        *running = Some((session.Value, handle));
    }
    Ok(())
}

pub fn stop() {
    let Some((_, trace)) = RUNNING.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
    // SAFETY: handle from OpenTraceW; stopping the session ends ProcessTrace.
    unsafe {
        CloseTrace(PROCESSTRACE_HANDLE { Value: trace });
    }
    stop_session();
    *PIDS.write().unwrap_or_else(|e| e.into_inner()) = None;
    *TALLY.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Endpoint {
    pub ip: String,
    pub port: u16,
    pub udp: bool,
    pub packets_per_sec: f64,
}

/// The endpoint the game exchanged the most packets with over the last few seconds.
pub fn server() -> Option<Endpoint> {
    let mut g = TALLY.lock().unwrap_or_else(|e| e.into_inner());
    let t = g.as_mut()?;
    let now = Instant::now();
    let since = *t.rotated.get_or_insert(now);
    if now.duration_since(since) >= WINDOW / 2 {
        t.prev = std::mem::take(&mut t.cur);
        t.rotated = Some(now);
    }
    busiest(t, WINDOW.as_secs_f64())
}

fn busiest(t: &Tally, secs: f64) -> Option<Endpoint> {
    let mut sum: HashMap<(IpAddr, u16, bool), u64> = t.prev.clone();
    for (k, v) in &t.cur {
        *sum.entry(*k).or_default() += v;
    }
    // Prefer UDP (game traffic); TCP only if the game uses nothing else.
    let best = sum.iter().filter(|(k, _)| k.2).max_by_key(|(_, v)| **v).or_else(|| sum.iter().max_by_key(|(_, v)| **v))?;
    let pps = *best.1 as f64 / secs;
    (pps >= 5.0).then(|| Endpoint { ip: best.0 .0.to_string(), port: best.0 .1, udp: best.0 .2, packets_per_sec: (pps * 10.0).round() / 10.0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v4_event(pid: u32, d: [u8; 4], s: [u8; 4], dport: u16, sport: u16) -> Vec<u8> {
        let mut v = pid.to_le_bytes().to_vec();
        v.extend(100u32.to_le_bytes());
        v.extend(d);
        v.extend(s);
        v.extend(dport.to_be_bytes());
        v.extend(sport.to_be_bytes());
        v.extend([0u8; 8]);
        v
    }

    #[test]
    fn parses_and_finds_the_server() {
        let send = parse(42, &v4_event(7, [162, 249, 72, 1], [192, 168, 1, 5], 7086, 50000)).unwrap();
        assert!(send.udp && send.send);
        assert_eq!(send.dport, 7086);
        let recv = parse(43, &v4_event(7, [192, 168, 1, 5], [162, 249, 72, 1], 50000, 7086)).unwrap();
        let local: HashSet<IpAddr> = [IpAddr::V4(Ipv4Addr::new(192, 168, 1, 5))].into();
        assert_eq!(remote(&send, &local), (IpAddr::V4(Ipv4Addr::new(162, 249, 72, 1)), 7086));
        assert_eq!(remote(&recv, &local), (IpAddr::V4(Ipv4Addr::new(162, 249, 72, 1)), 7086));
        assert!(parse(99, &[0; 40]).is_none());
        assert!(parse(42, &[0; 10]).is_none());

        let mut t = Tally::default();
        t.cur.insert((IpAddr::V4(Ipv4Addr::new(162, 249, 72, 1)), 7086, true), 600);
        t.cur.insert((IpAddr::V4(Ipv4Addr::new(104, 16, 0, 1)), 8443, false), 900);
        t.cur.insert((IpAddr::V4(Ipv4Addr::new(10, 0, 0, 2)), 3000, true), 20);
        let e = busiest(&t, 6.0).unwrap();
        assert_eq!((e.ip.as_str(), e.port, e.udp), ("162.249.72.1", 7086, true));
        assert_eq!(e.packets_per_sec, 100.0);
    }
}
