import { motion } from "framer-motion";

const STEPS = { hardware: "Getting to know your PC…", games: "Looking for your games…", ready: "All set" } as const;

/** Full-window intro shown while the first hardware/game scan runs. */
export function Splash({ step }: { step: keyof typeof STEPS }) {
  return (
    <motion.div
      className="fixed inset-0 z-[60] grid place-items-center bg-void bg-void-mesh"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.02, filter: "blur(6px)" }}
      transition={{ type: "spring", bounce: 0, duration: 0.5 }}
      data-tauri-drag-region
    >
      <div className="flex flex-col items-center" data-tauri-drag-region>
        <svg viewBox="0 0 1024 1024" className="h-[92px] w-[92px]" aria-label="FreshOptimizer">
          <motion.path
            d="M170 262 H450 V352 H270 V468 H420 V556 H270 V762 H170 Z"
            style={{ fill: "rgb(var(--accent))" }}
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.6, delay: 0.1 }}
          />
          <motion.circle
            cx="660"
            cy="512"
            r="196"
            fill="none"
            style={{ stroke: "rgb(var(--accent))" }}
            strokeWidth="96"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ type: "spring", bounce: 0, duration: 0.9, delay: 0.2 }}
          />
        </svg>
        <motion.h1
          className="mt-6 text-[28px] font-bold tracking-[-0.02em]"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", bounce: 0, duration: 0.5, delay: 0.35 }}
        >
          Fresh<span className="text-crimson">Optimizer</span>
        </motion.h1>
        <motion.p
          key={step}
          className="mt-2 text-[13px] text-slate-muted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.25 }}
        >
          {STEPS[step]}
        </motion.p>
        <div className="mt-5 h-[3px] w-[180px] overflow-hidden rounded-full bg-white/[0.06]">
          <motion.div
            className="bg-accent-fill h-full rounded-full"
            initial={{ width: "8%" }}
            animate={{ width: step === "hardware" ? "45%" : step === "games" ? "80%" : "100%" }}
            transition={{ type: "spring", bounce: 0, duration: 0.6 }}
          />
        </div>
      </div>
    </motion.div>
  );
}
