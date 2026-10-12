import { useEffect, useRef } from "react";
import type { MotionId, Settings, WallpaperId } from "../lib/theme";

const A = (a: number) => `rgb(var(--accent) / ${a})`;
const ALT = (a: number) => `rgb(var(--accent-alt) / ${a})`;

/** Wallpaper art, drawn with gradients in the theme colours (no image files). */
export function wallpaperCss(id: WallpaperId): string {
  switch (id) {
    case "glow":
      return [
        `radial-gradient(1100px 600px at 88% -12%, ${A(0.16)}, transparent 62%)`,
        `radial-gradient(800px 520px at -8% 112%, ${ALT(0.09)}, transparent 60%)`,
      ].join(",");
    case "aurora":
      return [
        `radial-gradient(60% 45% at 20% 18%, ${A(0.28)}, transparent 70%)`,
        `radial-gradient(55% 40% at 78% 30%, ${ALT(0.24)}, transparent 70%)`,
        `radial-gradient(70% 50% at 55% 95%, ${A(0.14)}, transparent 70%)`,
        `linear-gradient(160deg, transparent 30%, ${ALT(0.06)} 60%, transparent 85%)`,
      ].join(",");
    case "nebula":
      return [
        `radial-gradient(1.2px 1.2px at 12% 22%, rgba(255,255,255,.7), transparent)`,
        `radial-gradient(1px 1px at 36% 64%, rgba(255,255,255,.55), transparent)`,
        `radial-gradient(1.4px 1.4px at 68% 18%, rgba(255,255,255,.65), transparent)`,
        `radial-gradient(1px 1px at 84% 72%, rgba(255,255,255,.5), transparent)`,
        `radial-gradient(1.2px 1.2px at 52% 42%, rgba(255,255,255,.45), transparent)`,
        `radial-gradient(1px 1px at 22% 86%, rgba(255,255,255,.5), transparent)`,
        `radial-gradient(1.3px 1.3px at 92% 40%, rgba(255,255,255,.6), transparent)`,
        `radial-gradient(45% 55% at 30% 40%, ${A(0.24)}, transparent 70%)`,
        `radial-gradient(40% 50% at 72% 62%, ${ALT(0.26)}, transparent 70%)`,
        `radial-gradient(30% 30% at 55% 20%, ${A(0.12)}, transparent 70%)`,
      ].join(",");
    case "waves":
      return [
        `radial-gradient(120% 60% at 50% 110%, ${A(0.22)}, transparent 60%)`,
        `radial-gradient(90% 40% at 20% 95%, ${ALT(0.3)}, transparent 65%)`,
        `repeating-radial-gradient(160% 90% at 50% 140%, transparent 0 46px, ${A(0.05)} 47px 48px)`,
        `radial-gradient(70% 50% at 85% -10%, ${ALT(0.18)}, transparent 70%)`,
      ].join(",");
    case "grid":
      return [
        `linear-gradient(${A(0.06)} 1px, transparent 1px)`,
        `linear-gradient(90deg, ${A(0.06)} 1px, transparent 1px)`,
        `radial-gradient(900px 500px at 85% 0%, ${A(0.18)}, transparent 65%)`,
        `radial-gradient(700px 420px at 0% 100%, ${ALT(0.1)}, transparent 60%)`,
      ].join(",");
    default:
      return "none";
  }
}

const GRID_SIZE = "44px 44px, 44px 44px, auto, auto";

/** Fixed full-window background layer: theme wallpaper or the user's own image. */
export function Backdrop({ settings, image }: { settings: Settings; image: string | null }) {
  const usingImage = settings.wallpaper === "image" && !!image;
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-void">
      <div
        className={`absolute -inset-[6%] ${settings.motion === "drift" ? "animate-drift" : ""}`}
        style={
          usingImage
            ? {
                backgroundImage: `url(${image})`,
                backgroundSize: "cover",
                backgroundPosition: "center",
                filter: `blur(${settings.blur}px)`,
              }
            : {
                backgroundImage: wallpaperCss(settings.wallpaper),
                backgroundSize: settings.wallpaper === "grid" ? GRID_SIZE : undefined,
                filter: settings.blur > 0 && settings.wallpaper !== "grid" ? `blur(${Math.round(settings.blur / 3)}px)` : undefined,
              }
        }
      />
      <MotionLayer motion={settings.motion} />
      {/* Readability: darken, then fade the edges back into the base colour. */}
      <div className="absolute inset-0" style={{ background: `rgb(var(--bg) / ${usingImage ? settings.dim / 100 : 0})` }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(130% 100% at 50% 40%, transparent 55%, rgb(var(--bg) / 0.65))" }} />
    </div>
  );
}

/** Animated overlay for the chosen motion style. Transform/opacity only. */
function MotionLayer({ motion }: { motion: MotionId }) {
  switch (motion) {
    case "breathe":
      return <div className="fo-breathe absolute -inset-[10%]" style={{ background: `radial-gradient(45% 40% at 70% 30%, ${A(0.22)}, transparent 70%), radial-gradient(40% 35% at 25% 75%, ${ALT(0.16)}, transparent 70%)` }} />;
    case "orbit":
      return (
        <div className="fo-orbit absolute left-1/2 top-1/2 h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2">
          <div className="absolute left-[18%] top-[30%] h-[34%] w-[34%] rounded-full blur-[90px]" style={{ background: A(0.28) }} />
          <div className="absolute bottom-[30%] right-[18%] h-[30%] w-[30%] rounded-full blur-[90px]" style={{ background: ALT(0.24) }} />
        </div>
      );
    case "flow":
      return (
        <div className="absolute inset-0 overflow-hidden">
          <div
            className="fo-flow absolute -inset-y-[20%] left-0 w-[300%] blur-[60px]"
            style={{
              background: `linear-gradient(100deg, transparent 0%, ${A(0.2)} 12%, transparent 22%, ${ALT(0.18)} 34%, transparent 46%, ${A(0.2)} 62%, transparent 72%, ${ALT(0.18)} 84%, transparent 100%)`,
            }}
          />
        </div>
      );
    case "scan":
      return <div className="fo-scan absolute inset-x-0 top-0 h-[38vh]" style={{ background: `linear-gradient(180deg, transparent, ${A(0.09)} 70%, ${A(0.18)} 98%, transparent)` }} />;
    case "stars":
      return <Stars />;
    default:
      return null;
  }
}

/** Canvas particle field: ~70 slow, twinkling dots in the accent colour. ~30 fps, paused when hidden. */
function Stars() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let w = 0;
    let h = 0;
    const resize = () => {
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const readAccent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim().split(/\s+/).join(",");
    let accent = readAccent();
    let frames = 0;
    const stars = Array.from({ length: 70 }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: 0.4 + Math.random() * 1.4,
      vx: -0.05 - Math.random() * 0.12,
      vy: 0.02 + Math.random() * 0.06,
      phase: Math.random() * Math.PI * 2,
      speed: 0.4 + Math.random() * 1.2,
      tinted: Math.random() < 0.35,
    }));
    let raf = 0;
    let last = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (document.hidden || t - last < 33) return;
      last = t;
      if (++frames % 30 === 0) accent = readAccent(); // follow theme changes
      ctx.clearRect(0, 0, w, h);
      for (const s of stars) {
        if (!reduced) {
          s.x += s.vx;
          s.y += s.vy;
          if (s.x < -4) s.x = w + 4;
          if (s.y > h + 4) s.y = -4;
        }
        const a = reduced ? 0.5 : 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t / 1000 * s.speed + s.phase));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fillStyle = s.tinted ? `rgba(${accent},${a})` : `rgba(255,255,255,${a * 0.8})`;
        ctx.fill();
      }
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="absolute inset-0 h-full w-full" />;
}
