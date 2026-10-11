import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri } from "../lib/api";

type Win = Awaited<ReturnType<typeof getWindow>>;

async function getWindow() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** Frameless window chrome: drag area + minimize / maximize / close. */
export function TitleBar() {
  const [win, setWin] = useState<Win | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    getWindow().then(async (w) => {
      setWin(w);
      setMaximized(await w.isMaximized());
      unlisten = await w.onResized(async () => setMaximized(await w.isMaximized()));
    });
    return () => unlisten?.();
  }, []);

  return (
    <div className="relative z-[70] flex h-9 shrink-0 select-none items-center" data-tauri-drag-region onDoubleClick={() => win?.toggleMaximize()}>
      <div className="pointer-events-none flex items-center gap-2 pl-4" data-tauri-drag-region>
        <svg viewBox="0 0 1024 1024" className="h-3.5 w-3.5" aria-hidden>
          <path d="M170 262 H450 V352 H270 V468 H420 V556 H270 V762 H170 Z" fill="#FF1E27" />
          <circle cx="660" cy="512" r="196" fill="none" stroke="#FF1E27" strokeWidth="96" />
        </svg>
        <span className="text-[12px] font-medium text-white/60">FreshOptimizer</span>
      </div>
      <div className="flex-1 self-stretch" data-tauri-drag-region />
      <div className="flex h-full" onDoubleClick={(e) => e.stopPropagation()}>
        <ChromeButton label="Minimize" onClick={() => win?.minimize()}>
          <Minus size={14} />
        </ChromeButton>
        <ChromeButton label={maximized ? "Restore" : "Maximize"} onClick={() => win?.toggleMaximize()}>
          {maximized ? <Copy size={11} className="-scale-x-100" /> : <Square size={11} />}
        </ChromeButton>
        <ChromeButton label="Close" danger onClick={() => win?.close()}>
          <X size={15} />
        </ChromeButton>
      </div>
    </div>
  );
}

function ChromeButton({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-full w-[46px] place-items-center text-white/60 transition-colors active:opacity-80 ${
        danger ? "hover:bg-[#E81123] hover:text-white" : "hover:bg-white/[0.08] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
