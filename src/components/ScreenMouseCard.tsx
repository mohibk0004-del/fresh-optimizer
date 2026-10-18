import { Monitor, MousePointer2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorText } from "../lib/api";
import type { ToastKind } from "../lib/hooks";
import type { DisplayInfo } from "../lib/types";
import { GlassCard } from "./GlassCard";

const KEEP_SECONDS = 15;
const STANDARD_RATES = [125, 250, 500, 1000, 2000, 4000, 8000];

/** Monitor refresh rate check + one-click fix, and a mouse polling-rate test. */
export function ScreenMouseCard({ notify }: { notify: (k: ToastKind, t: string, title?: string) => void }) {
  return (
    <GlassCard title="Screen and mouse" subtitle="Are they running as fast as they can?" icon={Monitor}>
      <div className="relative z-10 -mr-2 min-h-0 flex-1 overflow-y-auto pr-2">
        <Displays notify={notify} />
        <div className="my-3 h-px bg-white/[0.06]" />
        <MouseTest />
      </div>
    </GlassCard>
  );
}

interface Pending {
  device: string;
  prior: number;
  left: number;
}

function Displays({ notify }: { notify: (k: ToastKind, t: string, title?: string) => void }) {
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const read = useCallback(() => api.listDisplays().then(setDisplays).catch(() => setDisplays([])), []);
  useEffect(() => {
    read();
  }, [read]);

  const set = useCallback(
    async (device: string, hz: number) => {
      setBusy(true);
      try {
        const d = await api.setRefreshRate(device, hz);
        setDisplays((list) => list?.map((x) => (x.device === device ? d : x)) ?? null);
        return true;
      } catch (e) {
        notify("error", `Couldn't change the refresh rate: ${errorText(e)}`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [notify],
  );

  const fix = async (d: DisplayInfo) => {
    if (await set(d.device, d.maxHz)) setPending({ device: d.device, prior: d.currentHz, left: KEEP_SECONDS });
  };

  const revert = useCallback(async () => {
    if (!pending) return;
    setPending(null);
    await set(pending.device, pending.prior);
  }, [pending, set]);

  // Countdown: if the screen went black or flickers, it switches back by itself.
  useEffect(() => {
    if (!pending) return;
    if (pending.left <= 0) {
      revert();
      return;
    }
    const id = window.setTimeout(() => setPending((p) => (p ? { ...p, left: p.left - 1 } : p)), 1000);
    return () => window.clearTimeout(id);
  }, [pending, revert]);

  if (displays === null) return <p className="text-[12px] text-slate-muted">Reading your displays…</p>;
  if (displays.length === 0) return <p className="text-[12px] text-slate-muted">Couldn't read your display settings.</p>;

  return (
    <div className="space-y-2">
      {displays.map((d) => {
        const slow = d.currentHz < d.maxHz;
        const isPending = pending?.device === d.device;
        return (
          <div key={d.device} className="glass-inset px-3 py-2">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold">
                  {d.monitor}
                  {displays.length > 1 && d.primary && <span className="font-normal text-slate-muted"> · main</span>}
                </div>
                <div className="text-[11.5px] text-slate-muted">
                  {d.width}×{d.height} · <span className={slow ? "text-warn" : "text-success"}>{d.currentHz} Hz</span>
                  {slow ? ` of ${d.maxHz} Hz possible` : " · the fastest it offers"}
                </div>
              </div>
              {slow && !isPending && (
                <button type="button" className="btn-ghost shrink-0" disabled={busy} onClick={() => fix(d)}>
                  Use {d.maxHz} Hz
                </button>
              )}
            </div>
            {isPending && pending && (
              <div className="mt-2 flex items-center gap-2 text-[11.5px]">
                <span className="flex-1 text-slate-muted">Looks right? Switching back in {pending.left}s.</span>
                <button type="button" className="btn-ghost" onClick={revert}>
                  Switch back
                </button>
                <button
                  type="button"
                  className="bg-accent-fill rounded-full px-3 py-1 font-semibold"
                  onClick={() => {
                    setPending(null);
                    notify("success", `Display now runs at ${d.currentHz} Hz.`, "Saved");
                  }}
                >
                  Keep
                </button>
              </div>
            )}
          </div>
        );
      })}
      {displays.some((d) => d.currentHz < d.maxHz) && !pending && (
        <p className="text-[11px] leading-relaxed text-slate-muted">
          Windows often leaves fast monitors at 60 Hz after a new cable or driver. This is the same setting as Display settings → Advanced display.
        </p>
      )}
    </div>
  );
}

type MouseState = { phase: "idle" } | { phase: "listening"; events: number } | { phase: "done"; hz: number; raw: boolean };

/**
 * Counts the mouse reports Windows delivers while you move. `pointerrawupdate`
 * fires once per raw report; where it's missing we fall back to coalesced
 * pointermove events, which carry the same reports in batches.
 */
function MouseTest() {
  const [state, setState] = useState<MouseState>({ phase: "idle" });
  const pad = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.phase !== "listening" || !pad.current) return;
    const el = pad.current;
    const raw = "onpointerrawupdate" in el;
    const stamps: number[] = [];
    const onRaw = (e: PointerEvent) => stamps.push(e.timeStamp);
    const onMove = (e: PointerEvent) => {
      const list = e.getCoalescedEvents?.() ?? [e];
      for (const c of list) stamps.push(c.timeStamp);
    };
    const type = raw ? "pointerrawupdate" : "pointermove";
    const handler = raw ? onRaw : onMove;
    el.addEventListener(type, handler as EventListener);

    const tick = window.setInterval(() => setState((s) => (s.phase === "listening" ? { phase: "listening", events: stamps.length } : s)), 200);
    const end = window.setTimeout(() => {
      // Busiest 100 ms windows while moving: pauses in movement don't count.
      const rates: number[] = [];
      for (let i = 0, j = 0; i < stamps.length; i++) {
        while (stamps[j] < stamps[i] - 100) j++;
        if (i - j >= 10) rates.push((i - j) * 10);
      }
      rates.sort((a, b) => a - b);
      const top = rates.slice(Math.floor(rates.length * 0.8));
      const hz = top.length ? top[Math.floor(top.length / 2)] : 0;
      setState({ phase: "done", hz, raw });
    }, 3000);
    return () => {
      el.removeEventListener(type, handler as EventListener);
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [state.phase]);

  const nearest = (hz: number) => STANDARD_RATES.reduce((a, b) => (Math.abs(b - hz) < Math.abs(a - hz) ? b : a));

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
        <MousePointer2 size={14} className="text-slate-muted" /> Mouse polling rate
      </div>
      <div
        ref={pad}
        role="button"
        tabIndex={0}
        onClick={() => state.phase !== "listening" && setState({ phase: "listening", events: 0 })}
        className={`glass-inset grid h-[74px] cursor-crosshair select-none place-items-center px-3 text-center text-[12px] transition-colors ${
          state.phase === "listening" ? "border-crimson-line text-white" : "text-slate-muted hover:border-white/15"
        }`}
      >
        {state.phase === "idle" && "Click here, then move your mouse in circles for 3 seconds"}
        {state.phase === "listening" && `Keep moving… ${state.events} reports`}
        {state.phase === "done" &&
          (state.hz < 60 ? (
            "Didn't see enough movement. Click to try again."
          ) : (
            <span>
              <span className="text-[20px] font-bold tabular-nums text-white">≈ {nearest(state.hz)} Hz</span>
              <span className="block text-[11px]">measured {state.hz} reports/s · click to test again</span>
            </span>
          ))}
      </div>
      {state.phase === "done" && state.hz >= 60 && (
        <p className="mt-2 text-[11px] leading-relaxed text-slate-muted">
          {nearest(state.hz) < 1000
            ? "Most gaming mice can do 1000 Hz. If yours can, raise it in the mouse's own software for smoother, quicker aiming."
            : "That's a gaming-grade rate."}{" "}
          {!state.raw && "This app view batches some reports, so the real rate may be higher. "}
          Above 1000 Hz, readings here can be lower than the real rate; your mouse software has the final word.
        </p>
      )}
    </div>
  );
}
