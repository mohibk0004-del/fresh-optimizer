import type { TweakInfo } from "./types";

export type ProfileId = "competitive" | "balanced" | "laptop";

export const PROFILES: { id: ProfileId; name: string; blurb: string; pick: (t: TweakInfo[]) => string[] }[] = [
  {
    id: "competitive",
    name: "Competitive",
    blurb: "Everything for the lowest lag, including CPU sleep states off and raw mouse input. Runs hotter and uses more power.",
    pick: (t) => t.filter((x) => x.defaultOn || ["cstate_lock", "mouse_accel_off", "widgets_off", "background_apps"].includes(x.id)).map((x) => x.id),
  },
  {
    id: "balanced",
    name: "Balanced",
    blurb: "Our recommended set: real gains with nothing you'll notice in everyday use.",
    pick: (t) => t.filter((x) => x.defaultOn).map((x) => x.id),
  },
  {
    id: "laptop",
    name: "Laptop",
    blurb: "Recommended set without the power-hungry parts, so battery life and fan noise stay normal.",
    pick: (t) => t.filter((x) => x.defaultOn && !["power_scheme", "nic_eee", "cstate_lock"].includes(x.id)).map((x) => x.id),
  },
];

/** The profile whose selection exactly matches `enabled`, if any. */
export function matchProfile(tweaks: TweakInfo[], enabled: Set<string>): ProfileId | null {
  for (const p of PROFILES) {
    const ids = p.pick(tweaks);
    if (ids.length === enabled.size && ids.every((id) => enabled.has(id))) return p.id;
  }
  return null;
}
