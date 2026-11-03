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
 * Speed: each home's within-10 km list is worked out once (O(n²)); each pass then reads kept counts of untaken
 * neighbours instead of re-measuring every pair.
 */
export function groupByArea(homes: readonly AreaHome[]): AreaGroup[] {
  const located = homes.filter(isLocated);
  const n = located.length;
  const near: number[][] = located.map((_, i) => [i]);
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (distanceM(located[i]!, located[j]!) <= RADIUS_M) {
        near[i]!.push(j);
        near[j]!.push(i);
      }
  for (const list of near) list.sort((a, b) => a - b); // input order, as the old untaken-list scan gave
  const count = near.map((l) => l.length);
  const taken = new Array<boolean>(n).fill(false);
  const groups: AreaHome[][] = [];
  for (let left = n; left > 0;) {
    let centre = -1;
    for (let i = 0; i < n; i++)
      if (!taken[i] && (centre < 0 || count[i]! > count[centre]!)) centre = i;
    const members = near[centre]!.filter((k) => !taken[k]);
    for (const k of members) {
      taken[k] = true;
      for (const m of near[k]!) count[m]!--;
    }
    left -= members.length;
    groups.push(members.map((k) => located[k]!).sort(byRank));
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
