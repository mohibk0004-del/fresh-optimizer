import { motion } from "framer-motion";
import { Crosshair, Gamepad2 } from "lucide-react";
import type { ActiveGame, CpuTopology, GameInfo } from "../lib/types";
import { Dot, GlassCard } from "./GlassCard";

interface Props {
  games: GameInfo[] | null;
  active: ActiveGame[];
  topology: CpuTopology | undefined;
  launchPriority: boolean;
  highlight?: boolean;
}

const MONO: Record<string, string> = { valorant: "VL", cs2: "CS", apex: "AX", overwatch: "OW" };

export function GamesCard({ games, active, topology, launchPriority, highlight }: Props) {
  const affinity = topology ? (topology.hybrid ? `P-cores only (${topology.pCores}P)` : `All ${topology.physicalCores} cores`) : "—";

  return (
    <GlassCard
      id="games"
      title="Game Profiles"
      subtitle="Auto-detected competitive titles"
      icon={Gamepad2}
      highlight={highlight}
      delay={0.15}
      action={
        <span className="chip border-obsidian-line bg-white/[0.03] text-slate-muted">
          <Crosshair size={11} /> {games ? games.filter((g) => g.installed).length : 0} found
        </span>
      }
    >
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {(games ?? Array.from({ length: 4 }, () => null)).map((g, i) => {
          if (!g) return <div key={i} className="glass-inset h-[52px] animate-pulse" />;
          const live = active.find((a) => a.game === g.name);
          const running = !!live || g.running;
          const priority = live ? (live.enforce.prioritySet ? "High" : (g.priority ?? "Protected")) : g.priority;
          return (
            <motion.div
              key={g.id}
              layout
              className={`glass-inset flex items-center gap-3 px-3 py-2 transition-colors ${running ? "!border-crimson-line !bg-crimson/[0.07]" : ""} ${g.installed ? "" : "opacity-45"}`}
            >
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold tracking-wide ${
                  running ? "bg-crimson text-white" : "border border-obsidian-line bg-white/[0.04] text-white/70"
                }`}
              >
                {MONO[g.id] ?? "?"}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[13px] font-medium">
                  {g.name}
                  {running && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-crimson-400">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-crimson opacity-75" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-crimson" />
                      </span>
                      Live
                    </span>
                  )}
                </div>
                <div className="truncate text-[11px] text-slate-muted" title={g.exePaths[0]}>
                  {g.installed ? (g.exePaths[0] ? g.exePaths[0].split("\\").slice(0, 3).join("\\") + "\\…" : "Running") : "Not installed"}
                </div>
              </div>
              {g.installed && (
                <div className="shrink-0 text-right text-[11px] leading-tight">
                  <div className="flex items-center justify-end gap-1.5 font-medium tabular-nums">
                    <Dot tone={priority === "High" ? "good" : running ? "warn" : launchPriority ? "good" : "off"} />
                    {running ? (priority ?? "Normal") : launchPriority ? "High @ launch" : "Default"}
                  </div>
                  <div className="text-slate-muted">{running ? (live?.enforce.affinitySet ? "P-cores" : "All cores") : "priority"}</div>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
        <div className="glass-inset px-3 py-1.5">
          <div className="label !text-[10px]">Affinity</div>
          <div className="mt-0.5 font-medium">{affinity}</div>
        </div>
        <div className="glass-inset px-3 py-1.5">
          <div className="label !text-[10px]">Thread priority</div>
          <div className="mt-0.5 font-medium">HIGH_PRIORITY_CLASS</div>
        </div>
      </div>
    </GlassCard>
  );
}
