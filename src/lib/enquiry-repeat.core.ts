// Pure rules for recognising the same owner + same home on a repeat calculator enquiry, and existing duplicates.
import { normaliseAuMobile, normaliseEmail } from "./test-send.core";

const ABBR: [RegExp, string][] = [[/\broad\b/g, "rd"], [/\bstreet\b/g, "st"], [/\bavenue\b/g, "ave"], [/\bdrive\b/g, "dr"], [/\bcrescent\b/g, "cres"], [/\bcourt\b/g, "ct"], [/\bplace\b/g, "pl"], [/\bparade\b/g, "pde"], [/\bterrace\b/g, "tce"], [/\bclose\b/g, "cl"]];
/** Street + postcode key. Strips a trailing ", Suburb VIC 3xxx" so both address styles match. */
export function repeatKey(address: string | null | undefined, _suburb: string | null | undefined, postcode: string | null | undefined): string | null {
  if (!address?.trim() || !postcode?.trim()) return null;
  let a = address.toLowerCase().split(",")[0]!.replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  for (const [re, to] of ABBR) a = a.replace(re, to);
  return a ? `${a}|${postcode.trim()}` : null;
}
export function sameOwner(a: { email: string | null; phone: string | null }, b: { email: string | null; phone: string | null } | null): boolean {
  if (!b) return false;
  const e1 = normaliseEmail(a.email), e2 = normaliseEmail(b.email);
  if (e1 && e1 === e2) return true;
  const p1 = normaliseAuMobile(a.phone), p2 = normaliseAuMobile(b.phone);
  return !!p1 && p1 === p2;
}
/** Groups of open jobs that look like the same owner + home. Flag only; never merge. */
export function possibleDuplicateGroups<T extends { id: string; jobNumber: string | null; email: string | null; phone: string | null; address: string | null; postcode: string | null; createdAt: string }>(jobs: T[]): T[][] {
  const groups: T[][] = [];
  const used = new Set<string>();
  for (const j of jobs) {
    if (used.has(j.id)) continue;
    const key = repeatKey(j.address, null, j.postcode);
    if (!key) continue;
    const g = jobs.filter((k) => !used.has(k.id) && repeatKey(k.address, null, k.postcode) === key && (k.id === j.id || sameOwner(j, k)));
    if (g.length > 1) { g.forEach((k) => used.add(k.id)); groups.push(g.sort((x, y) => y.createdAt.localeCompare(x.createdAt))); }
  }
  return groups;
}
