/** @type {import('tailwindcss').Config} */
// Every theme-able colour is a CSS variable (space-separated RGB) set by
// src/lib/theme.ts, so switching themes is instant and needs no rebuild.
const rgb = (v) => `rgb(var(${v}) / <alpha-value>)`;
const accent = (a) => `rgb(var(--accent) / ${a})`;

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          DEFAULT: rgb("--bg"),
          900: rgb("--bg"),
          800: rgb("--bg-2"),
          700: rgb("--bg-3"),
        },
        obsidian: {
          DEFAULT: rgb("--surface"),
          glass: "rgb(var(--surface) / var(--glass-alpha))",
          line: "rgba(255, 255, 255, 0.06)",
        },
        // Named "crimson" for history; it is the theme accent.
        crimson: {
          DEFAULT: rgb("--accent"),
          400: rgb("--accent-hi"),
          500: rgb("--accent"),
          600: rgb("--accent-lo"),
          line: accent(0.18),
          glow: accent(0.35),
        },
        slate: { muted: "#8F94A6" },
        success: "#00FF9D",
        warn: "#FFB020",
      },
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "Cascadia Code", "Consolas", "monospace"],
      },
      borderRadius: {
        card: "18px",
      },
      backdropBlur: {
        glass: "24px",
      },
      backgroundImage: {
        "card-sheen": `radial-gradient(circle at top right, ${accent("calc(0.07 * var(--sheen))")}, transparent 60%)`,
        "card-sheen-strong": `radial-gradient(circle at top right, ${accent("calc(0.12 * var(--sheen))")}, transparent 55%)`,
      },
      boxShadow: {
        glass: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -20px rgba(0,0,0,0.8)",
        "crimson-sm": `0 0 8px ${accent(0.22)}`,
        "crimson-md": `0 0 18px ${accent(0.32)}`,
        "crimson-lg": `0 0 28px ${accent(0.4)}`,
        "success-sm": "0 0 6px rgba(0, 255, 157, 0.25)",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: `0 0 16px ${accent(0.28)}` },
          "50%": { boxShadow: `0 0 26px ${accent(0.42)}` },
        },
        drift: {
          "0%, 100%": { transform: "translate3d(0, 0, 0) scale(1.05)" },
          "50%": { transform: "translate3d(-2%, 1.5%, 0) scale(1.1)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 3.2s ease-in-out infinite",
        drift: "drift 40s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
