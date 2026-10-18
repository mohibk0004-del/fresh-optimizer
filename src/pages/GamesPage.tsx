import { FolderOpen, Gamepad2, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { LiveDot, Monogram, Switch } from "../components/ui";
import { api, errorText } from "../lib/api";
import type { Boost, ToastKind } from "../lib/hooks";
import type { GameInfo, GameKind, GamePrefs, GamePriority } from "../lib/types";
import type { AppData } from "../lib/useAppData";

const DEFAULT_PREFS: GamePrefs = { enabled: true, priority: "high", fastCores: true };
const TAB_KEY = "fo.gamesTab";

interface Props {
  boost: Boost;
  data: AppData;
  watcher: boolean;
  onWatcher: () => void;
  notify: (k: ToastKind, t: string) => void;
}

export function GamesPage({ boost, data, watcher, onWatcher, notify }: Props) {
  const [prefs, setPrefs] = useState<Record<string, GamePrefs>>({});
  const [tab, setTab] = useState<GameKind>(() => {
    try {
      return localStorage.getItem(TAB_KEY) === "story" ? "story" : "competitive";
    } catch {
      return "competitive";
    }
  });
  const hybrid = !!data.system?.profile.topology.hybrid;
  const pCores = data.system?.profile.topology.pCores ?? 0;

  useEffect(() => {
    api.gamePrefs().then(setPrefs).catch(() => {});
  }, []);

  const pickTab = (k: GameKind) => {
    setTab(k);
    try {
      localStorage.setItem(TAB_KEY, k);
    } catch {
      /* ignore */
    }
  };

  const update = async (id: string, patch: Partial<GamePrefs>) => {
    const next = { ...(prefs[id] ?? DEFAULT_PREFS), ...patch };
    setPrefs((p) => ({ ...p, [id]: next }));
    try {
      await api.setGamePrefs(id, next);
    } catch (e) {
      notify("error", `Couldn't save that: ${errorText(e)}`);
    }
  };

  const games = data.games;
  const { found, missing } = useMemo(() => {
    const list = (games ?? []).filter((g) => g.kind === tab);
    return { found: list.filter((g) => g.installed), missing: list.filter((g) => !g.installed) };
  }, [games, tab]);
  const count = (k: GameKind) => games?.filter((g) => g.kind === k && g.installed).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="glass-card flex items-center gap-4 p-4">
        <div className="relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/[0.05] text-crimson">
          <Gamepad2 size={18} />
        </div>
        <div className="relative z-10 min-w-0 flex-1">
          <div className="text-[14px] font-semibold">Full power for games</div>
          <div className="text-[12px] text-slate-muted">
            {watcher
              ? "When a game below starts, FreshOptimizer gives it priority and full power, then puts things back when you quit."
              : "Off. Games run with Windows' normal settings. Boost tweaks you've applied still stay on."}
          </div>
        </div>
        <Switch on={watcher} onChange={onWatcher} label="Full power for games" />
      </div>

      <div className="flex items-center justify-between gap-3 px-1">
        <div className="flex rounded-full border border-obsidian-line bg-black/30 p-0.5">
          {(
            [
              ["competitive", "Competitive"],
              ["story", "Story"],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => pickTab(k)}
              className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors active:scale-[0.97] ${tab === k ? "bg-accent-fill text-white" : "text-slate-muted hover:text-white"}`}
            >
              {label}
              {games && <span className="ml-1.5 opacity-70">{count(k)}</span>}
            </button>
          ))}
        </div>
        <span className="text-[12.5px] text-slate-muted">
          {games === null ? "Looking for your games…" : `${found.length} found on this PC · changes apply the next time a game starts`}
        </span>
      </div>

      <div className="-mr-2 min-h-0 flex-1 overflow-y-auto pb-20 pr-2">
        <div className="grid grid-cols-2 gap-3.5">
          {games === null
            ? Array.from({ length: 4 }, (_, i) => <div key={i} className="glass-card h-[210px] animate-pulse" />)
            : found.map((g) => (
                <GameCard
                  key={g.id}
                  game={g}
                  prefs={prefs[g.id] ?? DEFAULT_PREFS}
                  live={boost.engine?.activeGames.find((a) => a.game === g.name)}
                  hybrid={hybrid}
                  pCores={pCores}
                  icon={data.icons[g.id]}
                  onChange={(patch) => update(g.id, patch)}
                  notify={notify}
                />
              ))}
        </div>
        {games !== null && found.length === 0 && (
          <div className="glass-card p-5 text-center text-[13px] text-slate-muted">
            <span className="relative z-10">None of these games are installed here. We look in Steam, Epic Games, GOG, Riot, Battle.net, EA app and Ubisoft Connect.</span>
          </div>
        )}
        {missing.length > 0 && (
          <div className="mt-4">
            <div className="mb-2 px-1 text-[11.5px] font-medium uppercase tracking-wider text-slate-muted">Also supported · not found on this PC</div>
            <div className="flex flex-wrap gap-2">
              {missing.map((g) => (
                <span key={g.id} className="inline-flex items-center gap-2 rounded-full border border-obsidian-line bg-white/[0.03] py-1 pl-1 pr-3 text-[12px] text-slate-muted">
                  <Monogram id={g.id} size={20} />
                  {g.name}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface CardProps {
  game: GameInfo;
  prefs: GamePrefs;
  live: { enforce: { prioritySet: boolean; affinitySet: boolean | null; note: string | null } } | undefined;
  hybrid: boolean;
  pCores: number;
  icon?: string;
  onChange: (patch: Partial<GamePrefs>) => void;
  notify: (k: ToastKind, t: string) => void;
}

function GameCard({ game: g, prefs, live, hybrid, pCores, icon, onChange, notify }: CardProps) {
  const [launching, setLaunching] = useState(false);
  const playing = !!live || g.running;
  const off = !prefs.enabled;

  const play = async () => {
    setLaunching(true);
    try {
      notify("info", `${await api.launchGame(g.id)}…`);
    } catch (e) {
      notify("error", `Couldn't start ${g.name}: ${errorText(e)}`);
    }
    window.setTimeout(() => setLaunching(false), 2500);
  };

  return (
    <div className={`glass-card flex flex-col p-4 ${playing ? "!border-crimson-line" : ""}`}>
      <div className="relative z-10 flex items-center gap-3">
        <Monogram id={g.id} live={playing} size={44} icon={icon} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold" title={g.name}>
            {g.name}
          </div>
          <div className="flex items-center gap-1.5 text-[12px] text-slate-muted">
            {playing ? (
              <>
                <LiveDot /> <span className="text-white">Playing now · {g.priority ?? "checking"} priority</span>
              </>
            ) : off ? (
              "Full power skips this game"
            ) : (
              <>Ready{g.store && <span className="opacity-70"> · {g.store}</span>}</>
            )}
          </div>
        </div>
        <Switch on={prefs.enabled} onChange={() => onChange({ enabled: !prefs.enabled })} label={`Full power for ${g.name}`} />
      </div>

      <div className={`relative z-10 mt-4 space-y-3 transition-opacity ${off ? "pointer-events-none opacity-40" : ""}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium">Priority</div>
            <div className="text-[11.5px] text-slate-muted">How much Windows favours the game</div>
          </div>
          <Segmented
            value={prefs.priority}
            options={[
              ["high", "High"],
              ["aboveNormal", "Above normal"],
            ]}
            onChange={(v) => onChange({ priority: v as GamePriority })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-medium">Fastest cores only</div>
            <div className="text-[11.5px] text-slate-muted">{hybrid ? `Keeps the game on your ${pCores} performance cores` : "Your CPU's cores are all the same speed"}</div>
          </div>
          <Switch on={hybrid && prefs.fastCores} disabled={!hybrid} onChange={() => onChange({ fastCores: !prefs.fastCores })} label="Fastest cores only" />
        </div>
        {playing && live?.enforce.note && <p className="text-[11.5px] leading-snug text-warn">Anti-cheat blocks live changes here, so Windows' launch-time priority is used instead.</p>}
      </div>

      <div className="relative z-10 mt-auto flex items-center gap-2 pt-4">
        <button
          type="button"
          onClick={play}
          disabled={launching || playing}
          className="bg-accent-fill inline-flex h-9 items-center gap-2 rounded-full px-4 text-[13px] font-semibold transition hover:brightness-110 active:scale-[0.97] disabled:opacity-50"
        >
          <Play size={13} fill="currentColor" /> {playing ? "Running" : launching ? "Starting…" : "Play"}
        </button>
        <button type="button" className="btn-ghost !h-9 !rounded-full !px-3" onClick={() => api.openGameFolder(g.id).catch((e) => notify("error", errorText(e)))} title={g.exePaths[0]}>
          <FolderOpen size={13} /> Folder
        </button>
      </div>
    </div>
  );
}

export function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="flex shrink-0 rounded-lg border border-obsidian-line bg-black/30 p-0.5">
      {options.map(([v, label]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors active:scale-[0.97] ${value === v ? "bg-accent-fill text-white" : "text-slate-muted hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
