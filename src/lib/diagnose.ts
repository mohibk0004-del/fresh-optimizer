// Turns a ping summary + a hop-by-hop trace into a plain-English explanation.
// Rules only state what the measurements show; inferences are worded as
// "likely", and known measurement pitfalls (routers that rate-limit traceroute
// replies) are called out instead of being reported as problems.
import type { Hop, PingStats, Trace } from "./types";
import type { Tone } from "./copy";

export type Zone = "home" | "provider" | "internet" | "destination";

export interface Diagnosis {
  headline: string;
  tone: Tone;
  /** Where the trouble starts, if anywhere. */
  zone: Zone | null;
  why: string[];
  fixes: string[];
  /** What this target actually is, so numbers aren't over-interpreted. */
  aboutTarget: string;
}

const LOSS_REAL = 5; // % that persists to the destination
const JITTER_BAD = 4; // ms

export function aboutTarget(p: PingStats): string {
  switch (p.kind) {
    case "valve_relay":
      return "This is Valve's relay server nearest to you. CS2 match traffic travels through these relays, so this is close to what CS2 sees, although your match may be hosted in another city.";
    case "riot_web":
      return "VALORANT match servers don't answer pings, so this measures the route to Riot's website network (served by a content network). Treat it as a rough guide; the ping shown in-game is the real number.";
    default:
      return `${p.label} has servers in almost every city, so this mostly shows the quality of your own connection rather than any one game.`;
  }
}

/** Which part of the path a hop belongs to. Hop 1 is your router. */
export function zoneOf(hop: Hop, index: number, hops: Hop[]): Zone {
  if (hop.isDestination) return "destination";
  if (index === 0 && hop.private) return "home";
  // Provider: private / carrier-NAT hops right after the router, plus the
  // first public hop (the provider's edge). Past that it's the wider internet.
  let lastProvider = 0;
  for (let i = 1; i < hops.length; i++) {
    const h = hops[i];
    if (h.isDestination) break;
    if (h.address === null || h.private || h.cgnat || i <= 2) lastProvider = i;
    else {
      lastProvider = i;
      break;
    }
  }
  return index <= lastProvider ? "provider" : "internet";
}

export const ZONE_LABEL: Record<Zone, string> = {
  home: "Your router",
  provider: "Your internet provider",
  internet: "The wider internet",
  destination: "Destination",
};

function responding(hops: Hop[]) {
  return hops.map((h, i) => ({ h, i })).filter(({ h }) => h.received > 0);
}

/** First hop where packet loss starts and carries on to the destination. */
function lossOrigin(trace: Trace) {
  const r = responding(trace.hops);
  const dest = r.find(({ h }) => h.isDestination);
  if (!dest || dest.h.lossPct < LOSS_REAL) return null;
  for (let k = 0; k < r.length; k++) {
    if (r.slice(k).every(({ h }) => h.lossPct >= LOSS_REAL)) return r[k];
  }
  return dest;
}

/** Hops that drop replies but the destination doesn't: harmless rate limiting. */
function rateLimitedHops(trace: Trace) {
  const dest = trace.hops.find((h) => h.isDestination);
  if (!dest || dest.lossPct >= LOSS_REAL) return [];
  return trace.hops.filter((h) => !h.isDestination && h.received > 0 && h.lossPct >= 20);
}

/** Where steady latency jumps by a lot and stays high: a long-distance link. */
function distanceJump(trace: Trace) {
  const r = responding(trace.hops).filter(({ h }) => h.bestMs !== null);
  const dest = r.find(({ h }) => h.isDestination);
  if (!dest) return null;
  let best: { at: number; added: number } | null = null;
  for (let k = 1; k < r.length; k++) {
    const prev = r[k - 1].h.bestMs!;
    const cur = r[k].h.bestMs!;
    const added = cur - prev;
    // Must persist: the destination stays at least this slow.
    if (added >= 25 && dest.h.bestMs! >= cur - 5 && (!best || added > best.added)) best = { at: r[k].i, added };
  }
  return best;
}

/** First hop where jitter becomes high and stays high to the destination. */
function jitterOrigin(trace: Trace) {
  const r = responding(trace.hops).filter(({ h }) => h.jitterMs !== null);
  const dest = r.find(({ h }) => h.isDestination);
  if (!dest || (dest.h.jitterMs ?? 0) < JITTER_BAD - 1) return null;
  for (let k = 0; k < r.length; k++) {
    if (r.slice(k).every(({ h }) => (h.jitterMs ?? 0) >= JITTER_BAD - 1)) return r[k];
  }
  return null;
}

const FIX: Record<Zone, string[]> = {
  home: [
    "Use an Ethernet cable instead of Wi-Fi if you can. It's the single biggest fix for spiky ping.",
    "On Wi-Fi, move closer to the router or switch to the 5 GHz network.",
    "Pause big downloads, game updates and video streams on other devices while you play.",
    "Restart your router. If it has a 'QoS', 'Smart Queue' or 'SQM' setting, turn it on.",
  ],
  provider: [
    "Restart your modem and router, then test again.",
    "Check whether it's worse at busy times (evenings). That points to a congested provider network.",
    "If it keeps happening, contact your internet provider and send them this report (Copy report below).",
  ],
  internet: [
    "This part of the path isn't controlled by you or your provider, and it's often temporary. Test again later.",
    "In the game, pick a server region closer to you if one is available.",
    "Gaming route services (\"gaming VPNs\") can sometimes avoid a bad path. Results vary, so test before paying.",
  ],
  destination: [
    "The problem is at the server itself. Try another server or region, or wait and test again.",
  ],
};

export function diagnose(p: PingStats, trace: Trace | null): Diagnosis {
  const about = aboutTarget(p);
  const base = { aboutTarget: about };

  if (p.error === "DNS resolution failed" || trace?.error) {
    return {
      ...base,
      headline: "Couldn't find this server's address",
      tone: "bad",
      zone: null,
      why: ["Windows couldn't look up the server's name, so nothing could be sent to it."],
      fixes: ["Check that you're online.", "Try clearing the DNS cache below, or switch DNS server on this page."],
    };
  }

  if (p.received === 0 && trace?.reached !== true) {
    const hopsOk = trace ? trace.hops.some((h) => h.received > 0) : false;
    return {
      ...base,
      headline: "This server doesn't answer pings",
      tone: "off",
      zone: null,
      why: [
        "Many servers ignore ping requests on purpose. That doesn't mean you can't connect or play.",
        hopsOk ? "Routers along the way did answer, so your connection is getting out fine." : "No router along the way answered either.",
      ],
      fixes: hopsOk ? ["Nothing to fix. Use the in-game ping for this server instead."] : FIX.home.slice(0, 1).concat(FIX.provider.slice(0, 1)),
    };
  }

  const why: string[] = [];
  const fixes: string[] = [];
  let zone: Zone | null = null;
  let tone: Tone = "good";
  let headline = "Healthy route";

  if (trace) {
    const hops = trace.hops;
    const zoneAt = (i: number) => zoneOf(hops[i], i, hops);

    const loss = lossOrigin(trace);
    if (loss) {
      zone = zoneAt(loss.i);
      tone = "bad";
      headline = `Packets are being lost, starting at ${ZONE_LABEL[zone].toLowerCase()}`;
      why.push(`About ${Math.round(p.lossPct)}% of packets never arrive. The loss first appears at hop ${loss.h.ttl} and continues all the way to the server, so it's real (not just a router ignoring traces).`);
    }

    const jit = !loss ? jitterOrigin(trace) : null;
    if (jit) {
      zone = zoneAt(jit.i);
      tone = "warn";
      headline = `Ping is spiky, starting at ${ZONE_LABEL[zone].toLowerCase()}`;
      why.push(`Your ping varies by about ±${p.jitterMs.toFixed(1)} ms. The variation starts at hop ${jit.h.ttl}${zone === "home" ? ", inside your own home network" : ""}.`);
      if (zone === "home") why.push("Spiky ping inside a home network is usually Wi-Fi or another device using the connection heavily.");
    }

    const jump = distanceJump(trace);
    if (jump) {
      const z = zoneAt(jump.at);
      why.push(`About ${Math.round(jump.added)} ms is added at hop ${hops[jump.at].ttl} (${ZONE_LABEL[z].toLowerCase()}) and stays for the rest of the route. That's typical of a long-distance link, like a cable to another country.`);
      if (!loss && !jit) {
        tone = p.avgMs >= 100 ? "warn" : "good";
        headline = p.avgMs >= 60 ? "Stable, but the server is far away" : "Healthy route";
        fixes.push("Distance can't be tweaked away. If the game lets you choose, pick a server region closer to you.");
      }
    }

    const limited = rateLimitedHops(trace);
    if (limited.length) {
      why.push(`Hop${limited.length > 1 ? "s" : ""} ${limited.map((h) => h.ttl).join(", ")} drop some trace replies, but the server itself receives everything. Those routers just limit how often they reply to traces. It's harmless.`);
    }

    const home = hops[0];
    if (!loss && !jit && home && home.private && home.avgMs !== null && home.avgMs > 5) {
      tone = tone === "good" ? "warn" : tone;
      why.push(`Even your router takes ${home.avgMs.toFixed(0)} ms to answer. A wired connection normally answers in about 1 ms, so this suggests Wi-Fi or a busy router.`);
      if (!zone) zone = "home";
      if (headline === "Healthy route") headline = "Your home network is adding delay";
    }

    if (zone) fixes.unshift(...FIX[zone]);
  }

  if (!why.length) {
    why.push(`No packet loss, and ping holds steady around ${p.avgMs.toFixed(0)} ms (±${p.jitterMs.toFixed(1)} ms).`);
    if (trace) why.push(`Every part of the route, from your router to the server, looks clean.`);
  }
  if (!fixes.length) fixes.push("Nothing to fix here.");

  return { ...base, headline, tone, zone, why, fixes: Array.from(new Set(fixes)) };
}

/** Plain-text report suitable for sending to an internet provider. */
export function reportText(p: PingStats, trace: Trace | null, d: Diagnosis): string {
  const lines = [
    `FreshOptimizer route report: ${p.label} (${p.resolved ?? p.host})`,
    `Summary: ${d.headline}`,
    `Ping avg ${p.avgMs.toFixed(1)} ms, jitter ±${p.jitterMs.toFixed(1)} ms, loss ${p.lossPct.toFixed(0)}% (${p.received}/${p.sent})`,
    "",
    "Hop  Address           Avg ms  Jitter  Loss",
  ];
  for (const h of trace?.hops ?? []) {
    lines.push(
      `${String(h.ttl).padEnd(4)} ${(h.address ?? "*").padEnd(17)} ${(h.avgMs?.toFixed(1) ?? "-").padStart(6)}  ${(h.jitterMs?.toFixed(1) ?? "-").padStart(6)}  ${h.lossPct.toFixed(0).padStart(3)}%`,
    );
  }
  lines.push("", ...d.why);
  return lines.join("\n");
}
