/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: {
          DEFAULT: "#0B0B0E",
          900: "#0B0B0E",
          800: "#121216",
          700: "#18181E",
        },
        obsidian: {
          DEFAULT: "#16161D",
          glass: "rgba(22, 22, 29, 0.8)",
          line: "rgba(255, 255, 255, 0.06)",
        },
        crimson: {
          DEFAULT: "#FF1E27",
          400: "#FF334B",
          500: "#FF1E27",
          600: "#D9121B",
          line: "rgba(255, 30, 39, 0.15)",
          glow: "rgba(255, 30, 39, 0.35)",
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
        "void-mesh":
          "radial-gradient(1200px 600px at 85% -10%, rgba(255,30,39,0.06), transparent 60%), radial-gradient(900px 500px at -10% 110%, rgba(255,51,75,0.035), transparent 60%), linear-gradient(180deg, #0B0B0E 0%, #121216 100%)",
        "card-sheen":
          "radial-gradient(circle at top right, rgba(255, 30, 39, 0.07), transparent 60%)",
        "card-sheen-strong":
          "radial-gradient(circle at top right, rgba(255, 30, 39, 0.12), transparent 55%)",
      },
      boxShadow: {
        glass: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 20px 50px -20px rgba(0,0,0,0.8)",
        "crimson-sm": "0 0 8px rgba(255, 30, 39, 0.22)",
        "crimson-md": "0 0 18px rgba(255, 30, 39, 0.32)",
        "crimson-lg": "0 0 28px rgba(255, 30, 39, 0.4)",
        "success-sm": "0 0 6px rgba(0, 255, 157, 0.25)",
      },
      keyframes: {
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 16px rgba(255, 30, 39, 0.28)" },
          "50%": { boxShadow: "0 0 26px rgba(255, 30, 39, 0.42)" },
        },
      },
      animation: {
        "pulse-glow": "pulse-glow 3.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
