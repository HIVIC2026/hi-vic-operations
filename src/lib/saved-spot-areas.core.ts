// Saved spots grouped into ~10 km areas for the To release screen. PURE: no I/O. Recomputed on each load, never stored.
import { distanceM } from "./geo.core";

export type AreaHome = {
  jobId: string;
  lat: number | null;
  lng: number | null;
  suburb: string;
  rankKey: number;
};
export type AreaGroup = { key: string; heading: string; jobIds: string[]; locationKnown: boolean };

const RADIUS_M = 10_000;
const MAX_SUBURBS_IN_HEADING = 3;

type Located = AreaHome & { lat: number; lng: number };
const isLocated = (h: AreaHome): h is Located => h.lat !== null && h.lng !== null;

/** Top 3 suburbs by count (ties alphabetical) joined with " · ", then the home count. */
function headingFor(homes: readonly AreaHome[]): string {
  const counts = new Map<string, number>();
  for (const h of homes) {
    const s = h.suburb.trim();
    if (s) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const top = [...counts]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_SUBURBS_IN_HEADING)
    .map(([s]) => s);
  return `${top.length ? top.join(" · ") : "Nearby homes"} (${homes.length})`;
}

const byRank = (a: AreaHome, b: AreaHome) => a.rankKey - b.rankKey;

/**
 * Densest-first greedy, like `suggestBatches` but with no minimum or maximum size. Each located home is tried as a centre;
 * its group is every untaken home within 10 km of that centre. The largest is taken, removed, repeat. Every home lands in
 * exactly one group. Homes with no location go in one last group. Groups: biggest first, tie → best-ranked home;
 * homes inside a group keep the global best-first order.
 */
export function groupByArea(homes: readonly AreaHome[]): AreaGroup[] {
  let left = homes.filter(isLocated);
  const groups: AreaHome[][] = [];
  while (left.length) {
    let best: Located[] = [];
    for (const c of left) {
      const near = left.filter((h) => h === c || distanceM(c, h) <= RADIUS_M);
      if (near.length > best.length) best = near;
    }
    groups.push([...best].sort(byRank));
    const taken = new Set(best);
    left = left.filter((h) => !taken.has(h));
  }
  groups.sort((a, b) => b.length - a.length || a[0]!.rankKey - b[0]!.rankKey);
  const out: AreaGroup[] = groups.map((g) => ({
    key: g.map((h) => h.jobId).sort()[0]!,
    heading: headingFor(g),
    jobIds: g.map((h) => h.jobId),
    locationKnown: true,
  }));
  const unknown = homes.filter((h) => !isLocated(h)).sort(byRank);
  if (unknown.length) {
    out.push({
      key: unknown.map((h) => h.jobId).sort()[0]!,
      heading: `Location not known (${unknown.length})`,
      jobIds: unknown.map((h) => h.jobId),
      locationKnown: false,
    });
  }
  return out;
}
