import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  label: string;
  width?: number;
  /** Extra classes for the panel (e.g. overflow handling). */
  className?: string;
  children: ReactNode;
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Side sheet used by Route, Connection, Health and History: Esc closes, Tab stays
 * inside while open, and focus goes back to whatever opened it.
 */
export function Sheet({ open, onClose, label, width = 480, className = "overflow-y-auto", children }: Props) {
  const panel = useRef<HTMLElement>(null);
  // Parents pass a new onClose each render; keep the latest without re-running the effect.
  const close = useRef(onClose);
  close.current = onClose;
  // Remember what had focus at the moment the sheet opens (before children focus anything).
  const opener = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  if (open && !wasOpen.current) opener.current = document.activeElement as HTMLElement | null;
  wasOpen.current = open;

  useEffect(() => {
    if (!open) return;
    const back = opener.current;
    const t = window.setTimeout(() => {
      if (panel.current && !panel.current.contains(document.activeElement)) panel.current.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }, 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey, true);
      back?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.aside
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className={`glass-card m-3 mt-12 flex flex-col !rounded-[20px] !bg-void-800/95 p-5 ${className}`}
            style={{ width }}
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.35 }}
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
