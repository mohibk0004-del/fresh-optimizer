import type { Settings, WallpaperId } from "../lib/theme";

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
        className={`absolute -inset-[6%] ${settings.animate ? "animate-drift" : ""}`}
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
      {/* Readability: darken, then fade the edges back into the base colour. */}
      <div className="absolute inset-0" style={{ background: `rgb(var(--bg) / ${usingImage ? settings.dim / 100 : 0})` }} />
      <div className="absolute inset-0" style={{ background: "radial-gradient(130% 100% at 50% 40%, transparent 55%, rgb(var(--bg) / 0.65))" }} />
    </div>
  );
}
