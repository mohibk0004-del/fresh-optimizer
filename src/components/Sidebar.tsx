import { motion } from "framer-motion";
import { Cpu, Gamepad2, History, Home, Settings, SlidersHorizontal, Wifi, type LucideIcon } from "lucide-react";

export type PageId = "home" | "games" | "network" | "pc" | "tweaks" | "settings";

export const PAGES: { id: PageId; icon: LucideIcon; label: string; subtitle: string }[] = [
  { id: "home", icon: Home, label: "Home", subtitle: "Smoother games and lower ping, in one click." },
  { id: "games", icon: Gamepad2, label: "Games", subtitle: "Your competitive and story games, and how each one runs." },
  { id: "network", icon: Wifi, label: "Network", subtitle: "Your ping, its stability, and your network card." },
  { id: "pc", icon: Cpu, label: "My PC", subtitle: "Your hardware and how smoothly Windows runs on it." },
  { id: "tweaks", icon: SlidersHorizontal, label: "Tweaks", subtitle: "Choose exactly what Boost changes. Everything can be undone." },
];

export const SETTINGS_PAGE = { id: "settings" as const, icon: Settings, label: "Settings", subtitle: "Make FreshOptimizer yours: themes, startup and updates." };

interface Props {
  active: PageId;
  onSelect: (id: PageId) => void;
  onUndo: () => void;
  undoAvailable: boolean;
  updateAvailable: boolean;
}

export function Sidebar({ active, onSelect, onUndo, undoAvailable, updateAvailable }: Props) {
  return (
    <nav className="glass-card flex w-[64px] shrink-0 flex-col items-center gap-1.5 rounded-[22px] py-4" aria-label="Main">
      {PAGES.map((p) => (
        <NavButton key={p.id} icon={p.icon} label={p.label} active={active === p.id} onClick={() => onSelect(p.id)} />
      ))}
      <div className="flex-1" />
      <NavButton icon={History} label={undoAvailable ? "Undo all changes" : "Nothing to undo yet"} onClick={onUndo} disabled={!undoAvailable} />
      <NavButton
        icon={Settings}
        label={updateAvailable ? "Settings · update available" : "Settings"}
        active={active === "settings"}
        dot={updateAvailable}
        onClick={() => onSelect("settings")}
      />
    </nav>
  );
}

function NavButton({ icon: Icon, label, active, onClick, disabled, dot }: { icon: LucideIcon; label: string; active?: boolean; onClick: () => void; disabled?: boolean; dot?: boolean }) {
  return (
    <div className="group relative z-10">
      <button
        type="button"
        aria-label={label}
        aria-current={active ? "page" : undefined}
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
        {active && <motion.span layoutId="nav-bar" transition={{ type: "spring", bounce: 0, duration: 0.35 }} className="bg-accent-fill absolute -left-[11px] h-5 w-[3px] rounded-full" />}
        <Icon size={19} strokeWidth={2} className="relative" />
        {dot && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-crimson ring-2 ring-void" />}
      </button>
      <span className="pointer-events-none absolute left-[54px] top-1/2 z-50 -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-lg border border-obsidian-line bg-void-800/95 px-2.5 py-1.5 text-xs font-medium opacity-0 shadow-glass backdrop-blur transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
        {label}
      </span>
    </div>
  );
}
