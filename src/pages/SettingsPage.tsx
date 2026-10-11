import { Check, Download, ExternalLink, FolderOpen, ImagePlus, Palette, RefreshCw, RotateCcw, Settings2, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { wallpaperCss } from "../components/Backdrop";
import { GlassCard } from "../components/GlassCard";
import { Switch } from "../components/ui";
import { api, errorText, REPO_URL } from "../lib/api";
import type { ToastKind } from "../lib/hooks";
import { accentOf, fileToWallpaper, hslToRgb, PRESETS, rgbToHsl, toHex, WALLPAPERS, type SettingsApi, type ThemePreset } from "../lib/theme";
import type { UpdateInfo } from "../lib/types";

export type UpdateState = { status: "idle" | "checking" | "done" | "error" | "installing"; info: UpdateInfo | null; error?: string };

interface Props {
  s: SettingsApi;
  update: UpdateState;
  onCheck: () => void;
  notify: (k: ToastKind, t: string) => void;
}

export function SettingsPage({ s, update, onCheck, notify }: Props) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3.5">
      <Appearance s={s} notify={notify} />
      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto pr-0.5">
        <General s={s} notify={notify} />
        <Updates update={update} onCheck={onCheck} notify={notify} />
        <About notify={notify} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- appearance */

function Appearance({ s, notify }: { s: SettingsApi; notify: Props["notify"] }) {
  const { settings, update, pickTheme, image, setImage } = s;
  const fileRef = useRef<HTMLInputElement>(null);
  const accent = accentOf(settings);
  const [hue, sat] = rgbToHsl(accent);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      setImage(await fileToWallpaper(f));
      update({ wallpaper: "image" });
    } catch (e) {
      notify("error", errorText(e));
    }
  };

  return (
    <GlassCard
      title="Appearance"
      subtitle="Themes, colours and background"
      icon={Palette}
      action={
        <button type="button" className="btn-ghost" onClick={s.reset}>
          <RotateCcw size={12} /> Reset
        </button>
      }
    >
      <div className="-mr-1 flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
        <section>
          <div className="label mb-2">Themes</div>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((p) => (
              <ThemeTile key={p.id} preset={p} active={settings.themeId === p.id && !settings.customAccent} onClick={() => pickTheme(p)} />
            ))}
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <span className="label">Accent colour</span>
            <span className="flex items-center gap-2 text-[11.5px] text-slate-muted">
              <span className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ background: toHex(accent) }} />
              {toHex(accent).toUpperCase()}
              {settings.customAccent && (
                <button type="button" className="text-white/70 hover:text-white" onClick={() => update({ customAccent: null })} title="Use the theme's colour">
                  <X size={12} />
                </button>
              )}
            </span>
          </div>
          <Slider
            value={hue}
            min={0}
            max={359}
            track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"
            onChange={(h) => update({ customAccent: hslToRgb(h, Math.max(sat, 60), 55) })}
            label="Hue"
          />
          <div className="mt-3 flex items-center gap-3">
            <span className="w-[86px] shrink-0 text-[12px] text-slate-muted">Intensity</span>
            <Slider
              value={Math.max(sat, 20)}
              min={20}
              max={100}
              track={`linear-gradient(90deg, ${toHex(hslToRgb(hue, 20, 55))}, ${toHex(hslToRgb(hue, 100, 55))})`}
              onChange={(v) => update({ customAccent: hslToRgb(hue, v, 55) })}
              label="Intensity"
            />
            <span className="w-9 text-right text-[12px] tabular-nums text-slate-muted">{Math.max(sat, 20)}%</span>
          </div>
        </section>

        <section>
          <div className="label mb-2">Background</div>
          <div className="grid grid-cols-4 gap-2">
            {WALLPAPERS.map((w) => (
              <button
                key={w.id}
                type="button"
                onClick={() => update({ wallpaper: w.id })}
                className={`group relative h-[58px] overflow-hidden rounded-xl border text-left transition active:scale-[0.97] ${settings.wallpaper === w.id ? "border-crimson ring-1 ring-crimson" : "border-obsidian-line hover:border-white/20"}`}
              >
                <span className="absolute inset-0 bg-void" style={{ backgroundImage: wallpaperCss(w.id), backgroundSize: w.id === "grid" ? "12px 12px, 12px 12px, auto, auto" : undefined }} />
                <span className="absolute bottom-1.5 left-2 text-[11px] font-semibold drop-shadow">{w.name}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => (image ? update({ wallpaper: "image" }) : fileRef.current?.click())}
              className={`relative col-span-2 flex h-[58px] items-center justify-center gap-2 overflow-hidden rounded-xl border text-[12px] font-semibold transition active:scale-[0.98] ${settings.wallpaper === "image" ? "border-crimson ring-1 ring-crimson" : "border-dashed border-white/15 hover:border-white/30"}`}
            >
              {image && <span className="absolute inset-0 bg-cover bg-center opacity-70" style={{ backgroundImage: `url(${image})` }} />}
              <span className="relative flex items-center gap-2 drop-shadow">
                <ImagePlus size={14} /> {image ? "Your image" : "Use your own image"}
              </span>
            </button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          {image && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={12} /> Change image
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setImage(null);
                  if (settings.wallpaper === "image") update({ wallpaper: "glow" });
                }}
              >
                <X size={12} /> Remove
              </button>
            </div>
          )}
        </section>

        <section className="space-y-3">
          <Row label="Background blur" value={`${settings.blur}px`}>
            <Slider value={settings.blur} min={0} max={40} onChange={(v) => update({ blur: v })} label="Background blur" />
          </Row>
          <Row label="Darken image" value={`${settings.dim}%`} disabled={settings.wallpaper !== "image"}>
            <Slider value={settings.dim} min={0} max={90} onChange={(v) => update({ dim: v })} label="Darken image" disabled={settings.wallpaper !== "image"} />
          </Row>
          <Row label="Card opacity" value={`${settings.glass}%`}>
            <Slider value={settings.glass} min={40} max={100} onChange={(v) => update({ glass: v })} label="Card opacity" />
          </Row>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px] font-medium">Animated background</div>
              <div className="text-[11.5px] text-slate-muted">Slow drift. Turned off automatically if Windows asks for less motion.</div>
            </div>
            <Switch on={settings.animate} onChange={() => update({ animate: !settings.animate })} label="Animated background" />
          </div>
        </section>
      </div>
    </GlassCard>
  );
}

function ThemeTile({ preset: p, active, onClick }: { preset: ThemePreset; active: boolean; onClick: () => void }) {
  const a = `rgb(${p.accent.join(" ")})`;
  const alt = `rgb(${p.alt.join(" ")})`;
  const bg = `rgb(${p.bg.join(" ")})`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative h-[84px] overflow-hidden rounded-xl border text-left transition active:scale-[0.97] ${active ? "border-white/40 ring-1 ring-white/40" : "border-obsidian-line hover:border-white/20"}`}
      style={{ background: `radial-gradient(80% 90% at 85% 0%, ${a.replace(")", " / 0.45)")}, transparent 70%), radial-gradient(70% 80% at 0% 100%, ${alt.replace(")", " / 0.3)")}, transparent 70%), ${bg}` }}
    >
      {/* Mini window mock */}
      <span className="absolute left-2 top-2 flex gap-1">
        <span className="h-9 w-2 rounded-sm bg-white/10" />
        <span className="flex flex-col gap-1">
          <span className="h-2 w-10 rounded-sm bg-white/10" />
          <span className="h-[26px] w-10 rounded-sm bg-white/[0.06]" />
        </span>
      </span>
      <span className="absolute right-2 top-2 h-3 w-6 rounded-full" style={{ background: a }} />
      <span className="absolute bottom-1.5 left-2 text-[11.5px] font-semibold">{p.name}</span>
      {active && (
        <span className="absolute bottom-1.5 right-1.5 grid h-4 w-4 place-items-center rounded-full bg-white text-black">
          <Check size={10} strokeWidth={3.5} />
        </span>
      )}
    </button>
  );
}

function Row({ label, value, disabled, children }: { label: string; value: string; disabled?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex items-center gap-3 ${disabled ? "opacity-40" : ""}`}>
      <span className="w-[120px] shrink-0 text-[12.5px] font-medium">{label}</span>
      {children}
      <span className="w-11 text-right text-[12px] tabular-nums text-slate-muted">{value}</span>
    </div>
  );
}

function Slider({ value, min, max, onChange, label, track, disabled }: { value: number; min: number; max: number; onChange: (v: number) => void; label: string; track?: string; disabled?: boolean }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="fo-range min-w-0 flex-1"
      style={{ background: track ?? `linear-gradient(90deg, rgb(var(--accent)) ${pct}%, rgba(255,255,255,0.1) ${pct}%)` }}
    />
  );
}

/* ---------------------------------------------------------------- general */

function General({ s, notify }: { s: SettingsApi; notify: Props["notify"] }) {
  const [startup, setStartup] = useState<boolean | null>(null);
  useEffect(() => {
    api.getLaunchAtStartup().then(setStartup).catch(() => setStartup(false));
  }, []);

  const toggleStartup = async () => {
    const want = !startup;
    setStartup(want);
    try {
      setStartup(await api.setLaunchAtStartup(want));
    } catch (e) {
      setStartup(!want);
      notify("error", `Couldn't change that: ${errorText(e)}`);
    }
  };

  return (
    <GlassCard title="General" icon={Settings2}>
      <ul className="divide-y divide-white/[0.05]">
        <Toggle title="Launch at startup" body="Opens minimized when you sign in to Windows. No admin prompt." on={!!startup} disabled={startup === null} onChange={toggleStartup} />
        <Toggle title="Boost automatically" body="Runs Boost every time FreshOptimizer opens." on={s.settings.autoBoost} onChange={() => s.update({ autoBoost: !s.settings.autoBoost })} />
        <Toggle title="Check for updates on launch" body="Quietly asks GitHub if there's a newer version." on={s.settings.checkUpdates} onChange={() => s.update({ checkUpdates: !s.settings.checkUpdates })} />
      </ul>
    </GlassCard>
  );
}

function Toggle({ title, body, on, onChange, disabled }: { title: string; body: string; on: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium">{title}</div>
        <div className="text-[11.5px] text-slate-muted">{body}</div>
      </div>
      <Switch on={on} disabled={disabled} onChange={onChange} label={title} />
    </li>
  );
}

/* ---------------------------------------------------------------- updates */

function Updates({ update, onCheck, notify }: { update: UpdateState; onCheck: () => void; notify: Props["notify"] }) {
  const [installing, setInstalling] = useState(false);
  const info = update.info;

  const install = async () => {
    if (!info?.downloadUrl) return;
    setInstalling(true);
    notify("info", "Downloading the update… FreshOptimizer will close and the installer will open.");
    try {
      await api.installUpdate(info.downloadUrl);
    } catch (e) {
      notify("error", errorText(e));
      setInstalling(false);
    }
  };

  return (
    <GlassCard
      title="Updates"
      icon={Sparkles}
      action={
        <button type="button" className="btn-ghost" onClick={onCheck} disabled={update.status === "checking" || installing}>
          <RefreshCw size={12} className={update.status === "checking" ? "animate-spin" : ""} /> {update.status === "checking" ? "Checking…" : "Check for updates"}
        </button>
      }
    >
      {info?.available ? (
        <div className="rounded-xl border border-crimson-line bg-crimson/[0.07] p-3.5">
          <div className="text-[14px] font-semibold">Version {info.latest} is available</div>
          <div className="mt-0.5 text-[12px] text-slate-muted">
            You have {info.current}
            {info.sizeBytes ? ` · ${(info.sizeBytes / 1048576).toFixed(1)} MB download` : ""}
          </div>
          {info.notes && <p className="mt-2 line-clamp-3 whitespace-pre-line text-[12px] leading-relaxed text-white/75">{info.notes.replace(/[#*>`]/g, "").trim()}</p>}
          <div className="mt-3 flex gap-2">
            {info.downloadUrl && (
              <button type="button" onClick={install} disabled={installing} className="inline-flex h-9 items-center gap-2 rounded-full bg-crimson px-4 text-[13px] font-semibold transition hover:bg-crimson-400 active:scale-[0.97] disabled:opacity-60">
                {installing ? <RefreshCw size={13} className="animate-spin" /> : <Download size={13} />} {installing ? "Downloading…" : "Update now"}
              </button>
            )}
            <button type="button" className="btn-ghost !h-9 !rounded-full !px-3" onClick={() => api.openProjectUrl(info.pageUrl).catch(() => {})}>
              <ExternalLink size={12} /> What's new
            </button>
          </div>
        </div>
      ) : (
        <p className="text-[12.5px] text-slate-muted">
          {update.status === "checking"
            ? "Asking GitHub for the latest version…"
            : update.status === "error"
              ? update.error
              : info
                ? `You're up to date (version ${info.current}).`
                : "FreshOptimizer can check GitHub for new versions and install them for you."}
        </p>
      )}
    </GlassCard>
  );
}

/* ---------------------------------------------------------------- about */

function About({ notify }: { notify: Props["notify"] }) {
  const [version, setVersion] = useState("");
  useEffect(() => {
    api.appVersion().then(setVersion).catch(() => {});
  }, []);
  const open = (url: string) => api.openProjectUrl(url).catch((e) => notify("error", errorText(e)));

  return (
    <GlassCard title="About" icon={Sparkles}>
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 1024 1024" className="h-10 w-10" aria-hidden>
          <path d="M170 262 H450 V352 H270 V468 H420 V556 H270 V762 H170 Z" style={{ fill: "rgb(var(--accent))" }} />
          <circle cx="660" cy="512" r="196" fill="none" style={{ stroke: "rgb(var(--accent))" }} strokeWidth="96" />
        </svg>
        <div>
          <div className="text-[14px] font-semibold">FreshOptimizer {version}</div>
          <div className="text-[12px] text-slate-muted">Anti-cheat safe. Every change can be undone.</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost" onClick={() => open(REPO_URL)}>
          <ExternalLink size={12} /> GitHub
        </button>
        <button type="button" className="btn-ghost" onClick={() => open(`${REPO_URL}/issues`)}>
          <ExternalLink size={12} /> Report a problem
        </button>
        <button type="button" className="btn-ghost" onClick={() => api.openDataFolder().catch((e) => notify("error", errorText(e)))}>
          <FolderOpen size={12} /> Data folder
        </button>
      </div>
    </GlassCard>
  );
}
