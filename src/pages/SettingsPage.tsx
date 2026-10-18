import { Check, Download, ExternalLink, FolderOpen, HardDriveDownload, ImagePlus, Palette, RefreshCw, RotateCcw, Settings2, Sparkles, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { wallpaperCss } from "../components/Backdrop";
import { GlassCard } from "../components/GlassCard";
import { Switch } from "../components/ui";
import { api, errorText, REPO_URL } from "../lib/api";
import type { Boost, ToastKind } from "../lib/hooks";
import { buildSetup, parseSetup, type ParsedSetup } from "../lib/setupFile";
import { accent2Of, accentOf, fileToWallpaper, hslToRgb, MOTIONS, parseHex, PRESETS, WALLPAPER_TYPES, rgbToHsl, toHex, WALLPAPERS, type HSL, type RGB, type SettingsApi, type ThemePreset } from "../lib/theme";
import type { TimerMode, UpdateInfo } from "../lib/types";

export type UpdateState = { status: "idle" | "checking" | "done" | "error" | "installing"; info: UpdateInfo | null; error?: string };

interface Props {
  s: SettingsApi;
  update: UpdateState;
  onCheck: () => void;
  notify: (k: ToastKind, t: string) => void;
  boost: Boost;
  gameIds: string[];
}

export function SettingsPage({ s, update, onCheck, notify, boost, gameIds }: Props) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3.5">
      <Appearance s={s} notify={notify} />
      <div className="flex min-h-0 flex-col gap-3.5 overflow-y-auto pr-0.5">
        <General s={s} notify={notify} />
        <Updates update={update} onCheck={onCheck} notify={notify} />
        <Backup s={s} boost={boost} gameIds={gameIds} notify={notify} />
        <About notify={notify} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- appearance */

function Appearance({ s, notify }: { s: SettingsApi; notify: Props["notify"] }) {
  const { settings, update, pickTheme, image, setImage } = s;
  const reducedTransparency = useMediaQuery("(prefers-reduced-transparency: reduce)");
  const fileRef = useRef<HTMLInputElement>(null);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      await setImage(await fileToWallpaper(f));
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
            <label className="flex cursor-pointer items-center gap-2 text-[12px] text-slate-muted">
              Gradient
              <Switch on={settings.gradient} onChange={() => update({ gradient: !settings.gradient })} label="Two-colour gradient accent" />
            </label>
          </div>
          {settings.gradient && <div className="mb-3 h-2.5 rounded-full" style={{ background: "var(--accent-fill)" }} />}
          <AccentPicker
            label={settings.gradient ? "Colour 1" : undefined}
            rgb={accentOf(settings)}
            hsl={settings.customHsl}
            custom={!!settings.customAccent}
            onChange={(rgb, hsl) => update({ customAccent: rgb, customHsl: hsl })}
            onReset={() => update({ customAccent: null, customHsl: null })}
          />
          {settings.gradient && (
            <div className="mt-4">
              <AccentPicker
                label="Colour 2"
                rgb={accent2Of(settings)}
                hsl={settings.customHsl2}
                custom={!!settings.customAccent2}
                onChange={(rgb, hsl) => update({ customAccent2: rgb, customHsl2: hsl })}
                onReset={() => update({ customAccent2: null, customHsl2: null })}
              />
            </div>
          )}
        </section>

        <section>
          <div className="label mb-2">Card material</div>
          {reducedTransparency && settings.followTransparency && (
            <div className="mb-2 flex items-center gap-3 rounded-xl border border-warn/20 bg-warn/[0.06] px-3 py-2 text-[11.5px] leading-relaxed text-warn/90">
              <span className="flex-1">Windows' <b>Transparency effects</b> are off, so cards are shown solid and glass settings have no effect.</span>
              <button type="button" className="btn-ghost shrink-0" onClick={() => update({ followTransparency: false })}>
                Use glass anyway
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["frosted", "Frosted glass", "Soft blur, calm and readable"],
                ["liquid", "Liquid glass", "Clear glass that bends light at the edges"],
              ] as const
            ).map(([id, name, blurb]) => (
              <button
                key={id}
                type="button"
                onClick={() => update({ material: id })}
                className={`rounded-xl border px-3 py-2.5 text-left transition active:scale-[0.98] ${settings.material === id ? "border-crimson bg-crimson/10" : "border-obsidian-line hover:border-white/20"}`}
              >
                <div className="text-[13px] font-semibold">{name}</div>
                <div className="text-[11px] text-slate-muted">{blurb}</div>
              </button>
            ))}
          </div>
          {settings.material === "liquid" && (
            <div className="mt-3 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[12.5px] font-medium">Style</span>
                <div className="flex rounded-lg border border-obsidian-line bg-black/30 p-0.5">
                  {(
                    [
                      ["clear", "Clear"],
                      ["regular", "Regular"],
                    ] as const
                  ).map(([v, l]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => update({ liquid: { ...settings.liquid, style: v } })}
                      className={`rounded-md px-3 py-1 text-[11.5px] font-medium transition-colors ${settings.liquid.style === v ? "bg-accent-fill text-white" : "text-slate-muted hover:text-white"}`}
                    >
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {(
                [
                  ["refraction", "Refraction", 0, 100, "%"],
                  ["dispersion", "Colour split", 0, 100, "%"],
                  ["frost", "Frost", 0, 20, "px"],
                  ["glare", "Glare", 0, 100, "%"],
                  ["tint", "Tint", 0, 100, "%"],
                ] as const
              ).map(([key, label, min, max, unit]) => (
                <Row key={key} label={label} value={`${settings.liquid[key]}${unit}`}>
                  <Slider value={settings.liquid[key]} min={min} max={max} onChange={(v) => update({ liquid: { ...settings.liquid, [key]: v } })} label={label} />
                </Row>
              ))}
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[12.5px] font-medium">Interactive</div>
                  <div className="text-[11px] text-slate-muted">Light follows your cursor; glass gives a little when pressed</div>
                </div>
                <Switch on={settings.liquid.interactive} onChange={() => update({ liquid: { ...settings.liquid, interactive: !settings.liquid.interactive } })} label="Interactive liquid glass" />
              </div>
              <p className="text-[11px] text-slate-muted">Works best with a wallpaper or a lower card opacity, so there's something behind the glass to bend.</p>
            </div>
          )}
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
                <ImagePlus size={14} /> {image ? "Your image" : "Use your own image (PNG, JPG, GIF)"}
              </span>
            </button>
          </div>
          <input ref={fileRef} type="file" accept={WALLPAPER_TYPES} className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
          {image && (
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
                <ImagePlus size={12} /> Change image
              </button>
              <button
                type="button"
                className="btn-ghost"
                onClick={() => {
                  setImage(null).catch((e) => notify("error", errorText(e)));
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
          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-[12.5px] font-medium">Background animation</span>
              <span className="text-[11px] text-slate-muted">{MOTIONS.find((m) => m.id === settings.motion)?.blurb}</span>
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {MOTIONS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => update({ motion: m.id })}
                  title={m.blurb}
                  className={`rounded-lg border px-1 py-1.5 text-[11px] font-medium transition active:scale-[0.96] ${
                    settings.motion === m.id ? "border-crimson bg-crimson/15 text-white" : "border-obsidian-line text-slate-muted hover:border-white/20 hover:text-white"
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-slate-muted">Stops automatically if Windows is set to show fewer animations.</p>
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
        <Toggle
          title="Full power for games"
          body="While a supported game runs: high priority, fastest cores, sharper timer, full-power plan. Back to normal when it closes."
          on={s.settings.gameWatcher}
          onChange={() => s.update({ gameWatcher: !s.settings.gameWatcher })}
        />
        <Toggle
          title="Pause Windows Update while playing"
          body="Same as Pause updates in Windows Settings, only while a game runs, then set back. If FreshOptimizer closes mid-game, the pause still ends within a day."
          on={s.settings.pauseUpdates}
          onChange={() => s.update({ pauseUpdates: !s.settings.pauseUpdates })}
        />
        <Toggle
          title="Calm busy background apps while playing"
          body="Programs using lots of CPU or disk get low priority until your game closes. Nothing is ever closed for you."
          on={s.settings.autoLowerHogs}
          onChange={() => s.update({ autoLowerHogs: !s.settings.autoLowerHogs })}
        />
        <Toggle
          title="Keep running in the tray when closed"
          body="Full power for games and FPS measurement keep working with the window closed. The window itself is fully closed, so it uses almost no memory. Quit from the tray icon."
          on={s.settings.closeToTray}
          onChange={() => s.update({ closeToTray: !s.settings.closeToTray })}
        />
        <Toggle title="Alt+Shift+F shows or hides FreshOptimizer" body="Works from anywhere, including in games running in borderless mode." on={s.settings.hotkey} onChange={() => s.update({ hotkey: !s.settings.hotkey })} />
        <Toggle title="Boost automatically" body="Runs Boost once every time FreshOptimizer opens." on={s.settings.autoBoost} onChange={() => s.update({ autoBoost: !s.settings.autoBoost })} />
        <Toggle
          title="Follow Windows transparency setting"
          body="When Windows' Transparency effects are off, show cards solid."
          on={s.settings.followTransparency}
          onChange={() => s.update({ followTransparency: !s.settings.followTransparency })}
        />
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
              <button type="button" onClick={install} disabled={installing} className="bg-accent-fill inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition hover:brightness-110 active:scale-[0.97] disabled:opacity-60">
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
          <div className="text-[12px] text-slate-muted">Never touches game memory. Every change can be undone.</div>
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

/* ---------------------------------------------------------------- backup */

function Backup({ s, boost, gameIds, notify }: { s: SettingsApi; boost: Boost; gameIds: string[]; notify: Props["notify"] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ParsedSetup | null>(null);

  const exportNow = async () => {
    try {
      let timerMode: TimerMode = "match";
      try {
        const m = localStorage.getItem("fo.timerMode");
        if (m === "off" || m === "always") timerMode = m;
      } catch {
        /* ignore */
      }
      const prefs = await api.gamePrefs().catch(() => ({}));
      const path = await api.exportSetup(JSON.stringify(buildSetup(s.settings, boost.enabled, timerMode, prefs), null, 2));
      notify("success", `Saved to ${path}`);
    } catch (e) {
      notify("error", `Couldn't export: ${errorText(e)}`);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 1_000_000) throw new Error("That file is too large to be a setup file.");
      setPending(parseSetup(await f.text(), s.settings, boost.enabled, boost.tweaks, gameIds));
    } catch (e) {
      notify("error", errorText(e));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const apply = async () => {
    if (!pending) return;
    s.update(pending.settings);
    if (pending.enabledTweaks) boost.select(pending.enabledTweaks);
    if (pending.timerMode) {
      try {
        localStorage.setItem("fo.timerMode", pending.timerMode);
      } catch {
        /* ignore */
      }
      await api.setTimerMode(pending.timerMode).catch(() => {});
    }
    for (const [id, prefs] of Object.entries(pending.gamePrefs)) await api.setGamePrefs(id, prefs).catch(() => {});
    setPending(null);
    notify("success", "Setup imported. Press Boost when you want the tweaks applied.");
  };

  return (
    <GlassCard title="Backup" subtitle="Move your setup to another PC" icon={HardDriveDownload}>
      <p className="text-[12px] leading-relaxed text-slate-muted">
        Saves your theme, settings, Boost switches, timer and per-game settings to a small file. Your wallpaper image and anything Boost changed in Windows stay on this PC.
      </p>
      {pending ? (
        <div className="glass-inset mt-3 px-3 py-2.5 text-[12.5px]">
          {pending.changes.length ? (
            <>
              <div className="font-medium">Importing will change:</div>
              <ul className="mt-1 list-disc pl-5 text-slate-muted">
                {pending.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </>
          ) : (
            <div className="text-slate-muted">That file matches your current setup. Nothing would change.</div>
          )}
          <div className="mt-2.5 flex gap-2">
            {pending.changes.length > 0 && (
              <button type="button" className="bg-accent-fill rounded-full px-3.5 py-1.5 text-[12px] font-semibold" onClick={apply}>
                Import
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <button type="button" className="btn-ghost" onClick={exportNow}>
            <Download size={12} /> Export
          </button>
          <button type="button" className="btn-ghost" onClick={() => fileRef.current?.click()}>
            <Upload size={12} /> Import
          </button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
        </div>
      )}
    </GlassCard>
  );
}

/** Hue / intensity / lightness sliders plus a hex field. Works on exact HSL so
 * moving one slider never changes the others. */
function AccentPicker({
  label,
  rgb,
  hsl,
  custom,
  onChange,
  onReset,
}: {
  label?: string;
  rgb: RGB;
  hsl: HSL | null;
  custom: boolean;
  onChange: (rgb: RGB, hsl: HSL) => void;
  onReset: () => void;
}) {
  const [h, sat, l] = hsl ?? rgbToHsl(rgb);
  const [hex, setHex] = useState(toHex(rgb).toUpperCase());
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setHex(toHex(rgb).toUpperCase());
    setBad(false);
  }, [rgb[0], rgb[1], rgb[2]]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (nh: number, ns: number, nl: number) => onChange(hslToRgb(nh, ns, nl), [nh, ns, nl]);
  const commitHex = () => {
    const parsed = parseHex(hex);
    if (!parsed) return setBad(true);
    onChange(parsed, rgbToHsl(parsed));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {label && <span className="text-[12px] font-medium">{label}</span>}
        <span className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{ background: toHex(rgb) }} />
        <input
          value={hex}
          onChange={(e) => {
            setHex(e.target.value);
            setBad(false);
          }}
          onBlur={commitHex}
          onKeyDown={(e) => e.key === "Enter" && commitHex()}
          spellCheck={false}
          maxLength={7}
          aria-label={`${label ?? "Accent"} hex colour`}
          aria-invalid={bad}
          className={`w-[86px] rounded-md border bg-black/30 px-2 py-1 font-mono text-[12px] uppercase tracking-wide outline-none transition focus:border-white/30 focus-visible:ring-2 focus-visible:ring-crimson-400 ${bad ? "border-crimson-400 text-crimson-400" : "border-obsidian-line text-white"}`}
          placeholder="#FF1E27"
        />
        {bad && <span className="text-[11px] text-crimson-400">Use a code like #A4F028</span>}
        {custom && (
          <button type="button" className="ml-auto text-[11px] text-slate-muted hover:text-white" onClick={onReset} title="Use the theme's colour">
            Use theme colour
          </button>
        )}
      </div>
      <div className="space-y-2.5">
        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[12px] text-slate-muted">Hue</span>
          <Slider value={h} min={0} max={359} track="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)" onChange={(v) => set(v, sat, l)} label="Hue" />
          <span className="w-10 text-right text-[12px] tabular-nums text-slate-muted">{h}\u00b0</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[12px] text-slate-muted">Intensity</span>
          <Slider value={sat} min={0} max={100} track={`linear-gradient(90deg, ${toHex(hslToRgb(h, 0, l))}, ${toHex(hslToRgb(h, 100, l))})`} onChange={(v) => set(h, v, l)} label="Intensity" />
          <span className="w-10 text-right text-[12px] tabular-nums text-slate-muted">{sat}%</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-[72px] shrink-0 text-[12px] text-slate-muted">Lightness</span>
          <Slider value={l} min={25} max={85} track={`linear-gradient(90deg, ${toHex(hslToRgb(h, sat, 25))}, ${toHex(hslToRgb(h, sat, 55))}, ${toHex(hslToRgb(h, sat, 85))})`} onChange={(v) => set(h, sat, v)} label="Lightness" />
          <span className="w-10 text-right text-[12px] tabular-nums text-slate-muted">{l}%</span>
        </div>
      </div>
    </div>
  );
}

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, [query]);
  return match;
}
