import { motion } from "framer-motion";
import { Activity, Cpu, Gamepad2, History, LayoutGrid, Radar, type LucideIcon } from "lucide-react";

export type NavId = "dashboard" | "system" | "games" | "engine" | "network";

const items: { id: NavId; icon: LucideIcon; label: string }[] = [
  { id: "dashboard", icon: LayoutGrid, label: "Dashboard" },
  { id: "system", icon: Cpu, label: "System & Latency" },
  { id: "games", icon: Gamepad2, label: "Game Profiles" },
  { id: "engine", icon: Activity, label: "Optimization Engine" },
  { id: "network", icon: Radar, label: "Network & Packet Guard" },
];

interface Props {
  active: NavId;
  onSelect: (id: NavId) => void;
  onRestore: () => void;
  restoreAvailable: boolean;
}

export function Sidebar({ active, onSelect, onRestore, restoreAvailable }: Props) {
  return (
    <nav className="glass-card flex w-[64px] shrink-0 flex-col items-center gap-1.5 rounded-[22px] py-4">
      <div className="relative z-10 mb-4 grid h-10 w-10 place-items-center">
        <svg viewBox="0 0 1024 1024" className="h-9 w-9 drop-shadow-[0_0_6px_rgba(255,30,39,0.3)]" aria-label="FreshOptimizer">
          <path d="M170 262 H450 V352 H270 V468 H420 V556 H270 V762 H170 Z" fill="#FF1E27" />
          <circle cx="660" cy="512" r="196" fill="none" stroke="#FF1E27" strokeWidth="96" />
        </svg>
      </div>
      {items.map((it) => (
        <NavButton key={it.id} icon={it.icon} label={it.label} active={active === it.id} onClick={() => onSelect(it.id)} />
      ))}
      <div className="flex-1" />
      <NavButton icon={History} label={restoreAvailable ? "Revert to baseline" : "No restore point yet"} onClick={onRestore} disabled={!restoreAvailable} />
    </nav>
  );
}

function NavButton({ icon: Icon, label, active, onClick, disabled }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="group relative z-10">
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        className={`relative grid h-11 w-11 place-items-center rounded-xl transition-[color,background-color,transform] active:scale-[0.94] active:duration-75 disabled:opacity-30 ${
          active ? "text-white" : "text-slate-muted hover:bg-white/[0.04] hover:text-white"
        }`}
      >
        {active && (
          <motion.span
            layoutId="nav-pill"
            className="absolute inset-0 rounded-xl border border-crimson-line bg-crimson/[0.12]"
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
          />
        )}
        {active && <motion.span layoutId="nav-bar" transition={{ type: "spring", bounce: 0, duration: 0.35 }} className="absolute -left-[11px] h-5 w-[3px] rounded-full bg-crimson" />}
        <Icon size={19} strokeWidth={2} className="relative" />
      </button>
      <span className="pointer-events-none absolute left-[54px] top-1/2 z-50 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-lg border border-obsidian-line bg-void-800/95 px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-glass backdrop-blur transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}
