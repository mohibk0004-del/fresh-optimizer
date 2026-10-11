import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  id?: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  action?: ReactNode;
  hero?: boolean;
  highlight?: boolean;
  delay?: number;
  className?: string;
  children: ReactNode;
}

export function GlassCard({ id, title, subtitle, icon: Icon, action, hero, highlight, delay = 0, className = "", children }: Props) {
  return (
    <motion.section
      id={id}
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", bounce: 0, duration: 0.5, delay }}
      className={`glass-card ${hero ? "glass-card-hero" : ""} flex min-h-0 flex-col p-4 transition-[border-color,box-shadow] duration-300 hover:border-white/10 ${
        highlight ? "border-crimson-line shadow-crimson-sm" : ""
      } ${className}`}
    >
      <header className="relative z-10 mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-xl border border-crimson-line bg-crimson/10 text-crimson-400">
            <Icon size={16} strokeWidth={2.2} />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold leading-tight tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-muted">{subtitle}</p>}
          </div>
        </div>
        {action}
      </header>
      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </motion.section>
  );
}

export function Stat({ label, value, unit, tone = "default", sub }: { label: string; value: ReactNode; unit?: string; tone?: "default" | "good" | "bad" | "warn"; sub?: ReactNode }) {
  const color = tone === "good" ? "text-success" : tone === "bad" ? "text-crimson-400" : tone === "warn" ? "text-warn" : "text-white";
  return (
    <div className="glass-inset px-3 py-2">
      <div className="label">{label}</div>
      <div className={`mt-1 flex items-baseline gap-1 text-lg font-semibold tabular-nums tracking-tight ${color}`}>
        {value}
        {unit && <span className="text-xs font-medium text-slate-muted">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 truncate text-[11px] text-slate-muted">{sub}</div>}
    </div>
  );
}

export function Dot({ tone }: { tone: "good" | "bad" | "warn" | "off" }) {
  const c = tone === "good" ? "bg-success shadow-success-sm" : tone === "bad" ? "bg-crimson shadow-crimson-sm" : tone === "warn" ? "bg-warn" : "bg-white/20";
  return <span className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${c}`} />;
}
