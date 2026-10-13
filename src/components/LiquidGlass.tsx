import { useEffect } from "react";
import type { LiquidParams } from "../lib/theme";

/**
 * "Liquid glass" card material, inspired by liquid-glass-studio (which renders
 * with WebGL shaders). Here every `.glass-card` gets an SVG filter applied via
 * `backdrop-filter`, so the real app content behind the card is refracted:
 *
 * - Refraction: a displacement map built from the card's rounded-rect signed
 *   distance field bends the backdrop near the edges, like a thick lens.
 * - Dispersion: red, green and blue are displaced by slightly different
 *   amounts and recombined, giving the colour fringe of real glass.
 * - Frost, glare and the fresnel rim are layered on with CSS.
 *
 * Maps are generated once per card size (half resolution, cached) and
 * regenerated only when a card is resized.
 */
export function LiquidGlass({ enabled, params }: { enabled: boolean; params: LiquidParams }) {
  useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      root.classList.remove("fo-liquid");
      return;
    }
    root.classList.add("fo-liquid");
    root.style.setProperty("--glare", String(params.glare / 100));

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.setAttribute("aria-hidden", "true");
    svg.style.position = "absolute";
    const defs = document.createElementNS(svg.namespaceURI, "defs");
    svg.appendChild(defs);
    document.body.appendChild(svg);

    const filters = new Map<string, string>(); // size key -> filter id
    const tracked = new Set<HTMLElement>();

    const apply = (el: HTMLElement) => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (w < 24 || h < 24) return;
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 18;
      const key = `${w}x${h}r${radius}`;
      let id = filters.get(key);
      if (!id) {
        id = `fo-lq-${filters.size}-${w}-${h}`;
        defs.appendChild(buildFilter(id, w, h, radius, params));
        filters.set(key, id);
      }
      const frost = params.style === "clear" ? params.frost * 0.25 : params.frost;
      const value = `url(#${id}) blur(${frost.toFixed(1)}px) saturate(${params.style === "clear" ? 140 : 170}%)`;
      el.style.backdropFilter = value;
      el.style.setProperty("-webkit-backdrop-filter", value);
    };

    const resize = new ResizeObserver((entries) => {
      for (const e of entries) apply(e.target as HTMLElement);
    });
    const track = (el: HTMLElement) => {
      if (tracked.has(el)) return;
      tracked.add(el);
      resize.observe(el);
      apply(el);
    };
    document.querySelectorAll<HTMLElement>(".glass-card").forEach(track);
    const mutations = new MutationObserver((list) => {
      for (const m of list) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.classList.contains("glass-card")) track(n);
          n.querySelectorAll<HTMLElement>(".glass-card").forEach(track);
        });
        m.removedNodes.forEach((n) => {
          if (n instanceof HTMLElement && tracked.has(n)) {
            tracked.delete(n);
            resize.unobserve(n);
          }
        });
      }
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    // Interactive: the specular highlight follows the cursor over each card.
    root.classList.toggle("fo-liquid-interactive", params.interactive);
    let raf = 0;
    let pending: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      pending = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const ev = pending;
        if (!ev) return;
        const card = (ev.target as Element | null)?.closest?.(".glass-card") as HTMLElement | null;
        if (!card) return;
        const r = card.getBoundingClientRect();
        card.style.setProperty("--mx", `${(((ev.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${(((ev.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
      });
    };
    if (params.interactive) window.addEventListener("pointermove", onMove, { passive: true });

    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
      root.classList.remove("fo-liquid-interactive");
      mutations.disconnect();
      resize.disconnect();
      tracked.forEach((el) => {
        el.style.backdropFilter = "";
        el.style.removeProperty("-webkit-backdrop-filter");
      });
      svg.remove();
      root.classList.remove("fo-liquid");
    };
  }, [enabled, params.style, params.refraction, params.dispersion, params.frost, params.glare, params.interactive]);

  return null;
}

/** Rounded-rect signed distance (negative inside) and outward normal at p. */
function sdf(px: number, py: number, hw: number, hh: number, r: number): [number, number, number] {
  const qx = Math.abs(px) - (hw - r);
  const qy = Math.abs(py) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const outside = Math.hypot(ox, oy);
  const d = outside + Math.min(Math.max(qx, qy), 0) - r;
  let nx: number;
  let ny: number;
  if (qx > 0 && qy > 0) {
    nx = ox / (outside || 1);
    ny = oy / (outside || 1);
  } else if (qx > qy) {
    nx = 1;
    ny = 0;
  } else {
    nx = 0;
    ny = 1;
  }
  return [d, nx * Math.sign(px || 1), ny * Math.sign(py || 1)];
}

const mapCache = new Map<string, string>();

/** R = x displacement, G = y displacement (128 = none). Half resolution. */
function displacementMap(w: number, h: number, radius: number): string {
  const key = `${w}x${h}r${radius}`;
  const hit = mapCache.get(key);
  if (hit) return hit;
  const s = 0.5;
  const mw = Math.max(2, Math.round(w * s));
  const mh = Math.max(2, Math.round(h * s));
  const canvas = document.createElement("canvas");
  canvas.width = mw;
  canvas.height = mh;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(mw, mh);
  const hw = mw / 2;
  const hh = mh / 2;
  const r = Math.min(radius * s, hw, hh);
  // Thickness of the bending band along the edge.
  const band = Math.max(8, Math.min(mw, mh) * 0.22);
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const [d, nx, ny] = sdf(x + 0.5 - hw, y + 0.5 - hh, hw, hh, r);
      const inside = -d;
      let amt = 0;
      if (inside > 0 && inside < band) {
        const t = 1 - inside / band;
        amt = t * t * (3 - 2 * t); // smoothstep: strongest at the rim
      }
      const i = (y * mw + x) * 4;
      // Sample from further inside: the edge magnifies like a convex lens.
      img.data[i] = 128 - nx * amt * 127;
      img.data[i + 1] = 128 - ny * amt * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL("image/png");
  mapCache.set(key, url);
  return url;
}

function buildFilter(id: string, w: number, h: number, radius: number, p: LiquidParams): SVGFilterElement {
  const NS = "http://www.w3.org/2000/svg";
  const el = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>) => {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
    return node;
  };
  const scale = (p.refraction / 100) * 70;
  const spread = (p.dispersion / 100) * 0.35;
  const f = el("filter", { id, x: 0, y: 0, width: w, height: h, filterUnits: "userSpaceOnUse", primitiveUnits: "userSpaceOnUse", "color-interpolation-filters": "sRGB" }) as SVGFilterElement;
  f.appendChild(el("feImage", { href: displacementMap(w, h, radius), x: 0, y: 0, width: w, height: h, preserveAspectRatio: "none", result: "map" }));
  const channels: [string, number, string][] = [
    ["r", scale * (1 + spread), "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"],
    ["g", scale, "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"],
    ["b", scale * (1 - spread), "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"],
  ];
  for (const [name, s, matrix] of channels) {
    f.appendChild(el("feDisplacementMap", { in: "SourceGraphic", in2: "map", scale: s.toFixed(2), xChannelSelector: "R", yChannelSelector: "G", result: `d${name}` }));
    f.appendChild(el("feColorMatrix", { in: `d${name}`, type: "matrix", values: matrix, result: name }));
  }
  f.appendChild(el("feBlend", { in: "r", in2: "g", mode: "screen", result: "rg" }));
  f.appendChild(el("feBlend", { in: "rg", in2: "b", mode: "screen" }));
  return f;
}
