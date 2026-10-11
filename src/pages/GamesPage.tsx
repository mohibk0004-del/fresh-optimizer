import { FolderOpen, Gamepad2, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { LiveDot, Monogram, Switch } from "../components/ui";
import { api, errorText } from "../lib/api";
import type { Boost, ToastKind } from "../lib/hooks";
import type { GameInfo, GamePrefs, GamePriority } from "../lib/types";
import type { AppData } from "../lib/useAppData";

const DEFAULT_PREFS: GamePrefs = { enabled: true, priority: "high", fastCores: true };

export function GamesPage({ boost, data, notify }: { boost: Boost; data: AppData; notify: (k: ToastKind, t: string) => void }) {
  const [prefs, setPrefs] = useState<Record<string, GamePrefs>>({});
  const hybrid = !!data.system?.profile.topology.hybrid;
  const pCores = data.system?.profile.topology.pCores ?? 0;

  useEffect(() => {
    api.gamePrefs().then(setPrefs).catch(() => {});
  }, []);

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
  const installed = games?.filter((g) => g.installed).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3.5">
      <div className="flex items-center justify-between px-1 text-[13px] text-slate-muted">
        <span>
          {games === null ? "Looking for your games…" : `${installed} of ${games.length} supported games found on this PC.`} Changes apply the next time a game starts.
        </span>
        <span className="flex items-center gap-1.5">
          <Gamepad2 size={13} /> {boost.engine?.running ? "Boost is on: watching for games" : "Boost is off: press Boost to start watching"}
        </span>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-3.5">
        {(games ?? Array.from({ length: 4 }, () => null)).map((g, i) =>
          g ? (
            <GameCard
              key={g.id}
              game={g}
              prefs={prefs[g.id] ?? DEFAULT_PREFS}
              live={boost.engine?.activeGames.find((a) => a.game === g.name)}
              hybrid={hybrid}
              pCores={pCores}
              onChange={(patch) => update(g.id, patch)}
              notify={notify}
            />
          ) : (
            <div key={i} className="glass-card animate-pulse" />
          ),
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
  onChange: (patch: Partial<GamePrefs>) => void;
  notify: (k: ToastKind, t: string) => void;
}

function GameCard({ game: g, prefs, live, hybrid, pCores, onChange, notify }: CardProps) {
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
    <div className={`glass-card flex flex-col p-4 ${playing ? "!border-crimson-line" : ""} ${g.installed ? "" : "opacity-50"}`}>
      <div className="relative z-10 flex items-center gap-3">
        <Monogram id={g.id} live={playing} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold">{g.name}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-slate-muted">
            {playing ? (
              <>
                <LiveDot /> <span className="text-white">Playing now · {g.priority ?? "checking"} priority</span>
              </>
            ) : g.installed ? (
              off ? "Boost skips this game" : "Ready"
            ) : (
              "Not installed"
            )}
          </div>
        </div>
        {g.installed && <Switch on={prefs.enabled} onChange={() => onChange({ enabled: !prefs.enabled })} label={`Boost ${g.name}`} />}
      </div>

      {g.installed && (
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
      )}

      {g.installed && (
        <div className="relative z-10 mt-auto flex items-center gap-2 pt-4">
          <button
            type="button"
            onClick={play}
            disabled={launching || playing}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-crimson px-4 text-[13px] font-semibold transition hover:bg-crimson-400 active:scale-[0.97] disabled:opacity-50"
          >
            <Play size={13} fill="currentColor" /> {playing ? "Running" : launching ? "Starting…" : "Play"}
          </button>
          <button type="button" className="btn-ghost !h-9 !rounded-full !px-3" onClick={() => api.openGameFolder(g.id).catch((e) => notify("error", errorText(e)))} title={g.exePaths[0]}>
            <FolderOpen size={13} /> Folder
          </button>
        </div>
      )}
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
          className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors active:scale-[0.97] ${value === v ? "bg-crimson/90 text-white" : "text-slate-muted hover:text-white"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
