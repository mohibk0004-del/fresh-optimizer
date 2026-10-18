import { Gauge, History, Loader2, Trash2, X } from "lucide-react";
import { Sheet } from "./Sheet";
import { useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { clearHistory, readHistory, type HistoryPoint } from "../lib/hooks";

const HOST = "1.1.1.1";
const PHASE_MS = 10_000;
const DOWN_URL = "https://speed.cloudflare.com/__down?bytes=";
const UP_URL = "https://speed.cloudflare.com/__up";
/** Stop a phase early once this much has moved, to go easy on capped plans. */
const BYTE_CAP = 250_000_000;

/** "Lag under load" (bufferbloat) test and the week's connection history. */
export function ConnectionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} label={"Connection check"} width={480} className="overflow-y-auto">
      <div className="relative z-10 mb-4 flex items-center justify-between">
              <div className="text-[16px] font-semibold">Connection check</div>
              <button type="button" className="grid h-7 w-7 place-items-center rounded-full text-slate-muted hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Close">
                <X size={15} />
              </button>
            </div>
            <div className="relative z-10 space-y-5">
              <LoadTest />
              <HistoryView />
            </div>
    </Sheet>
  );
}

/* ---------------- lag under load ---------------- */

type Step = "idle" | "download" | "upload";
interface Result {
  idle: number;
  down: number | null;
  up: number | null;
  downMbps: number;
  upMbps: number;
}

const median = (v: number[]) => {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function grade(added: number): { letter: string; tone: string; text: string } {
  if (added < 5) return { letter: "A+", tone: "text-success", text: "Your connection stays just as quick when it's busy. Downloads won't hurt your games." };
  if (added < 30) return { letter: "A", tone: "text-success", text: "Very little extra lag when the connection is busy." };
  if (added < 60) return { letter: "B", tone: "text-success", text: "Some extra lag when busy. Most people won't notice it." };
  if (added < 200)
    return {
      letter: "C",
      tone: "text-warn",
      text: "A download or upload elsewhere in the house will make games feel laggy. If your router has QoS or SQM (often called Smart Queue), turning it on usually fixes this.",
    };
  if (added < 400)
    return { letter: "D", tone: "text-warn", text: "Busy moments add a lot of lag. Turn on QoS/SQM on your router, or pause big downloads and cloud backups while you play." };
  return { letter: "F", tone: "text-crimson", text: "Your connection gets very laggy when busy. A router with SQM (Smart Queue) is the real fix; pausing downloads while you play helps meanwhile." };
}

function LoadTest() {
  const [step, setStep] = useState<Step | null>(null);
  const [live, setLive] = useState<number | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancel = useRef<AbortController | null>(null);

  const pingFor = async (ms: number, signal: AbortSignal) => {
    const out: number[] = [];
    const end = Date.now() + ms;
    while (Date.now() < end && !signal.aborted) {
      const r = await api.pingOnce(HOST).catch(() => null);
      if (r !== null) {
        out.push(r);
        setLive(r);
      }
      await new Promise((res) => setTimeout(res, 200));
    }
    return out;
  };

  /** Keeps the line full in one direction for PHASE_MS while pinging. */
  const loaded = async (dir: "download" | "upload", outer: AbortSignal) => {
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    outer.addEventListener("abort", stop);
    let bytes = 0;
    const started = performance.now();
    const worker = async () => {
      while (!ctl.signal.aborted && bytes < BYTE_CAP) {
        try {
          if (dir === "download") {
            const res = await fetch(`${DOWN_URL}${25_000_000}`, { signal: ctl.signal, cache: "no-store" });
            const reader = res.body?.getReader();
            if (!reader) return;
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes >= BYTE_CAP) ctl.abort();
            }
          } else {
            const body = new Uint8Array(4_000_000);
            await fetch(UP_URL, { method: "POST", body, signal: ctl.signal, cache: "no-store" });
            bytes += body.byteLength;
          }
        } catch {
          return;
        }
      }
    };
    const timer = window.setTimeout(stop, PHASE_MS);
    const workers = Promise.all([worker(), worker(), worker(), worker()]);
    // Give the line a second to fill before measuring.
    await new Promise((r) => setTimeout(r, 1000));
    const pings = await pingFor(PHASE_MS - 1500, ctl.signal);
    stop();
    window.clearTimeout(timer);
    await workers;
    outer.removeEventListener("abort", stop);
    const secs = (performance.now() - started) / 1000;
    return { ping: median(pings), mbps: (bytes * 8) / secs / 1e6, bytes };
  };

  const run = async () => {
    const ctl = new AbortController();
    cancel.current = ctl;
    setResult(null);
    setError(null);
    try {
      setStep("idle");
      const idle = median(await pingFor(4000, ctl.signal));
      if (idle === null) throw new Error("Couldn't reach Cloudflare to measure ping.");
      setStep("download");
      const d = await loaded("download", ctl.signal);
      if (ctl.signal.aborted) return;
      setStep("upload");
      const u = await loaded("upload", ctl.signal);
      if (ctl.signal.aborted) return;
      if (d.bytes === 0 && u.bytes === 0) throw new Error("Couldn't load the connection (speed.cloudflare.com didn't respond).");
      setResult({ idle, down: d.ping, up: u.ping, downMbps: d.mbps, upMbps: u.mbps });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep(null);
      setLive(null);
      cancel.current = null;
    }
  };

  const added = result ? Math.max(0, (result.down ?? result.idle) - result.idle, (result.up ?? result.idle) - result.idle) : 0;
  const g = result ? grade(added) : null;

  return (
    <section>
      <div className="mb-1 flex items-center gap-2 text-[13.5px] font-semibold">
        <Gauge size={15} className="text-crimson" /> Lag under load
      </div>
      <p className="text-[12px] leading-relaxed text-slate-muted">
        Measures how much your ping rises while the connection is full, like when someone else streams or downloads. This is called bufferbloat, and it's the most common
        cause of "my ping spikes for no reason". Takes about 25 seconds and uses Cloudflare's speed test servers.
      </p>

      {step ? (
        <div className="glass-inset mt-3 flex items-center gap-3 px-3 py-3 text-[12.5px]">
          <Loader2 size={15} className="animate-spin text-crimson" />
          <span className="flex-1">{step === "idle" ? "Measuring normal ping…" : step === "download" ? "Filling your download…" : "Filling your upload…"}</span>
          {live !== null && <span className="tabular-nums text-slate-muted">{Math.round(live)} ms</span>}
          <button type="button" className="btn-ghost" onClick={() => cancel.current?.abort()}>
            Stop
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={run}
          className="bg-accent-fill mt-3 inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition hover:brightness-110 active:scale-[0.97]"
        >
          {result ? "Test again" : "Start test"}
        </button>
      )}
      {error && <p className="mt-2 text-[12px] text-warn">{error}</p>}

      {result && g && (
        <div className="glass-inset mt-3 p-3">
          <div className="flex items-center gap-4">
            <div className={`text-[40px] font-bold leading-none ${g.tone}`}>{g.letter}</div>
            <div className="grid flex-1 grid-cols-3 gap-2 text-[11.5px]">
              <Stat label="Normal" value={`${Math.round(result.idle)} ms`} />
              <Stat label="Downloading" value={result.down === null ? "—" : `${Math.round(result.down)} ms`} sub={`+${Math.max(0, Math.round((result.down ?? result.idle) - result.idle))}`} />
              <Stat label="Uploading" value={result.up === null ? "—" : `${Math.round(result.up)} ms`} sub={`+${Math.max(0, Math.round((result.up ?? result.idle) - result.idle))}`} />
            </div>
          </div>
          <p className="mt-2 text-[12px] leading-relaxed">{g.text}</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-muted">
            Rough speeds during the test: {result.downMbps.toFixed(0)} Mbps down, {result.upMbps.toFixed(0)} Mbps up (to Cloudflare, from inside this app, so a dedicated speed
            test may show more). Other devices using your network during the test affect the result.
          </p>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-slate-muted">{label}</div>
      <div className="text-[14px] font-semibold tabular-nums">
        {value} {sub && <span className="text-[11px] font-normal text-slate-muted">{sub}</span>}
      </div>
    </div>
  );
}

/* ---------------- history ---------------- */

function HistoryView() {
  const [points, setPoints] = useState<HistoryPoint[]>(() => readHistory());
  const [range, setRange] = useState<"day" | "week">("day");

  const bars = useMemo(() => {
    const now = Date.now();
    const span = range === "day" ? 86400000 : 7 * 86400000;
    const slot = range === "day" ? 3600000 : 6 * 3600000;
    const count = span / slot;
    const start = Math.floor((now - span) / slot) * slot + slot;
    const out = Array.from({ length: count }, (_, i) => ({ t: start + i * slot, avg: [] as number[], loss: [] as number[], jitter: [] as number[] }));
    for (const p of points) {
      const i = Math.floor((p.t - start) / slot);
      if (i < 0 || i >= count) continue;
      if (p.avg !== null) out[i].avg.push(p.avg);
      out[i].loss.push(p.lossPct);
      out[i].jitter.push(p.jitter);
    }
    return out.map((b) => ({
      t: b.t,
      avg: b.avg.length ? b.avg.reduce((x, y) => x + y, 0) / b.avg.length : null,
      loss: b.loss.length ? b.loss.reduce((x, y) => x + y, 0) / b.loss.length : null,
      jitter: b.jitter.length ? Math.max(...b.jitter) : null,
    }));
  }, [points, range]);

  const max = Math.max(20, ...bars.map((b) => b.avg ?? 0)) * 1.1;
  const withData = bars.filter((b) => b.avg !== null);
  const worst = withData.reduce<(typeof bars)[number] | null>((w, b) => (!w || (b.avg ?? 0) > (w.avg ?? 0) ? b : w), null);
  const fmt = (t: number) =>
    range === "day" ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : new Date(t).toLocaleDateString([], { weekday: "short", hour: "2-digit" });

  return (
    <section>
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[13.5px] font-semibold">
          <History size={15} className="text-crimson" /> Ping history
        </div>
        <div className="flex rounded-lg border border-obsidian-line bg-black/30 p-0.5">
          {(
            [
              ["day", "24 hours"],
              ["week", "7 days"],
            ] as const
          ).map(([v, l]) => (
            <button
              key={v}
              type="button"
              onClick={() => setRange(v)}
              className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium ${range === v ? "bg-accent-fill text-white" : "text-slate-muted hover:text-white"}`}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <p className="text-[12px] leading-relaxed text-slate-muted">Recorded from the live ping while FreshOptimizer is open. Gaps are times it was closed or minimized.</p>

      {withData.length === 0 ? (
        <p className="glass-inset mt-3 px-3 py-4 text-center text-[12px] text-slate-muted">No history yet. Leave FreshOptimizer open for a few minutes.</p>
      ) : (
        <>
          <div className="glass-inset mt-3 flex h-[110px] items-end gap-[2px] px-2 pb-2 pt-3">
            {bars.map((b) => (
              <div
                key={b.t}
                className="group relative flex-1"
                style={{ height: `${b.avg === null ? 0 : Math.max(3, (b.avg / max) * 100)}%` }}
                title={b.avg === null ? undefined : `${fmt(b.t)}: ${Math.round(b.avg)} ms, ±${b.jitter?.toFixed(1)} ms, ${b.loss?.toFixed(1)}% loss`}
              >
                <div className={`h-full rounded-t-sm ${b.loss && b.loss >= 1 ? "bg-warn/80" : "bg-accent-fill opacity-80"} group-hover:opacity-100`} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[10.5px] text-slate-muted">
            <span>{fmt(bars[0].t)}</span>
            <span>now</span>
          </div>
          {worst?.avg != null && (
            <p className="mt-2 text-[11.5px] text-slate-muted">
              Highest: {Math.round(worst.avg)} ms around {fmt(worst.t)}. Orange bars had packet loss.
            </p>
          )}
          <button
            type="button"
            className="btn-ghost mt-2"
            onClick={() => {
              clearHistory();
              setPoints([]);
            }}
          >
            <Trash2 size={12} /> Clear history
          </button>
        </>
      )}
    </section>
  );
}
