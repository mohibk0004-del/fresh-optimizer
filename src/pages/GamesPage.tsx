import { Check, Cpu, Gamepad2, Monitor, Rocket, Zap } from "lucide-react";
import { GlassCard } from "../components/GlassCard";
import { LiveDot, Monogram } from "../components/ui";
import type { Boost } from "../lib/hooks";
import type { AppData } from "../lib/useAppData";

export function GamesPage({ boost, data }: { boost: Boost; data: AppData }) {
  const topo = data.system?.profile.topology;
  const launchHigh = boost.tasks["ifeo_priority"]?.state === "applied";
  const trueFullscreen = boost.tasks["fso"]?.state === "applied";
  const games = data.games ?? [];

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-3.5">
      <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-3.5">
        {(data.games === null ? Array.from({ length: 4 }, () => null) : games).map((g, i) => {
          if (!g) return <div key={i} className="glass-card animate-pulse" />;
          const live = boost.engine?.activeGames.find((a) => a.game === g.name);
          const playing = !!live || g.running;
          return (
            <div key={g.id} className={`glass-card flex flex-col p-4 ${playing ? "!border-crimson-line" : ""} ${g.installed ? "" : "opacity-50"}`}>
              <div className="relative z-10 flex items-center gap-3">
                <Monogram id={g.id} live={playing} size={42} />
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{g.name}</div>
                  <div className="flex items-center gap-1.5 text-[12px] text-slate-muted">
                    {playing ? (
                      <>
                        <LiveDot /> <span className="text-white">Playing now</span>
                      </>
                    ) : g.installed ? (
                      "Installed and ready"
                    ) : (
                      "Not installed"
                    )}
                  </div>
                </div>
              </div>
              {g.installed && (
                <ul className="relative z-10 mt-4 space-y-2 text-[12px]">
                  <Perk on={playing ? !!live?.enforce.prioritySet || g.priority === "High" : launchHigh} text={playing ? `Priority: ${g.priority ?? "checking…"}` : "Starts at high priority"} />
                  <Perk on={trueFullscreen} text="True fullscreen" />
                  {topo?.hybrid && <Perk on={!!live?.enforce.affinitySet} text="Runs on your fastest cores" />}
                </ul>
              )}
              {playing && live?.enforce.note && <p className="relative z-10 mt-2 text-[11px] leading-snug text-warn">Anti-cheat blocks live changes. Launch-time priority is used instead.</p>}
              {g.exePaths[0] && (
                <p className="relative z-10 mt-auto truncate pt-3 text-[11px] text-slate-muted/70" title={g.exePaths[0]}>
                  {g.exePaths[0]}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <GlassCard title="What happens when you play" icon={Gamepad2}>
        <ol className="space-y-3 text-[13px]">
          <Step icon={Rocket} title="We notice the game start" body="FreshOptimizer checks every 2 seconds. It never reads or touches game memory." />
          <Step icon={Zap} title="Full power switches on" body="Your CPU stops parking cores and the system clock sharpens to 0.5 ms." />
          <Step
            icon={Cpu}
            title="Your game goes first"
            body={topo?.hybrid ? `High priority, and only your ${topo.pCores} performance cores.` : "Windows gives the game high priority over background apps."}
          />
          <Step icon={Monitor} title="Back to normal afterwards" body="Close the game and everything returns to your usual power settings." />
        </ol>
        <p className="mt-auto rounded-xl border border-obsidian-line bg-black/20 px-3.5 py-3 text-[12px] leading-relaxed text-slate-muted">
          Safe with Vanguard, VAC and Easy Anti-Cheat: no injection, no memory reading, no hooks.
        </p>
      </GlassCard>
    </div>
  );
}

function Perk({ on, text }: { on: boolean; text: string }) {
  return (
    <li className={`flex items-center gap-2 ${on ? "text-white" : "text-slate-muted"}`}>
      <span className={`grid h-4 w-4 place-items-center rounded-full ${on ? "bg-success text-void" : "border border-white/15"}`}>{on && <Check size={10} strokeWidth={3.5} />}</span>
      {text}
    </li>
  );
}

function Step({ icon: Icon, title, body }: { icon: typeof Rocket; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-obsidian-line bg-white/[0.04] text-crimson-400">
        <Icon size={15} />
      </span>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 text-[12px] leading-relaxed text-slate-muted">{body}</div>
      </div>
    </li>
  );
}
