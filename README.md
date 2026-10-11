# FreshOptimizer

Anti-cheat-safe Windows latency tuner for competitive FPS (VALORANT, CS2, Apex Legends, Overwatch 2).
Tauri v2 + React 19 + Tailwind (crimson glass UI) over a Rust core that talks to Win32, the registry,
`netsh`, `powercfg` and the NetAdapter PowerShell module.

## Run

```bash
npm install
npm run dev            # UI only, in a browser, with mock data ("Preview data" chip)
npx tauri dev          # real app - run from an ELEVATED terminal (exe requires admin)
npx tauri build        # NSIS + MSI installers in src-tauri/target/release/bundle
```

`cargo test --lib` (in `src-tauri/`) runs read-only hardware probes plus a sandboxed registry
backup/rollback round-trip under `HKCU\Software\FreshOptimizerSelfTest`.

## How it works

| Layer | Where | Notes |
|---|---|---|
| Restore point | `restore.rs` | `%APPDATA%\com.freshoptimizer.app\RestorePoint.json`. Baseline recorded *before* every write, persisted atomically, first snapshot wins. Rollback replays in reverse; failed items stay in the file for retry. |
| Registry | `registry.rs` | Tracked DWORD/SZ writes; rollback restores raw value or deletes it and prunes keys the app created (only if empty). Locked keys → `AccessDenied`, never a panic. |
| NIC | `network.rs` | Matches standardized `RegistryKeyword`s (`*EEE`, `*InterruptModeration`, `*RSS`, `*LsoV2IPv4/6`, Green Ethernet variants). Unsupported keyword or value outside `ValidRegistryValues` → skipped. Props set with `-NoRestart`; adapter restarts **once** per boost. |
| TCP/IP | `tweaks.rs` | Nagle off (`TcpAckFrequency`/`TCPNoDelay` on active interface GUID), `NetworkThrottlingIndex=0xFFFFFFFF`, autotuning=normal. |
| Jitter probe | `ping.rs` | `IcmpSendEcho`, one thread + handle per target, QPC-timed RTT, RFC 3550-style jitter, loss %. |
| DPC proxy | `latency.rs` | TIME_CRITICAL thread spins on QPC 300 ms and records stolen-CPU gaps (LatencyMon-style, user mode). |
| Match engine | `engine.rs` | One thread, ToolHelp snapshot every 2 s. Game start → `HIGH_PRIORITY_CLASS`, P-core affinity on hybrid CPUs, 0.5 ms timer, Low-DPC power scheme. Last game exits → all released. Stops on app exit. |
| Power | `power.rs` | Duplicates High Performance → "FO Low-DPC" (no core parking, 100% min state, ASPM/USB suspend off, optional C-state lock). Only *active* in-match. |

## Anti-cheat stance

- No DLL injection, no `WriteProcessMemory`/`ReadProcessMemory`, no hooks, no drivers, no RAM "cleaners".
- Process handles: `PROCESS_SET_INFORMATION | PROCESS_QUERY_LIMITED_INFORMATION` only. If anti-cheat
  strips even that (Vanguard may), the engine reports it and relies on the IFEO `PerfOptions\CpuPriorityClass`
  tweak, which Windows itself applies at launch.

## Honest limits

- Idle overhead: the Rust engine is ~one process snapshot per 2 s. The WebView2 UI processes are
  separate and will exceed 45 MB while the window is open - minimise/close for minimum footprint.
- `GlobalTimerResolutionRequests` needs a reboot; Nagle changes affect new connections only.
- XMP/EXPO is a heuristic (configured vs. SPD/JEDEC speed); WMI cannot read the BIOS profile directly.
- Winsock reset needs a reboot.
