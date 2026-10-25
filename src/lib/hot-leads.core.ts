import centroids from "@/data/vic-postcode-centroids.json";
import { regionForPostcode, regionsForDeclaredAreas, type RegionId } from "./coverage-regions.core";

export const HOT_LEAD_BLOCKED = true;
export const HOT_SUBJECT = "Your ceiling insulation quote — save your spot";
export const HOT_EXCLUDE = /\b(?:test|qa|jo lowe|delete me|sam taylor|alex spark|dc construction)\b/i;
export type Trade = { id: string; name: string; kind: "installer" | "rec"; areas?: string[] | null; origin?: { latitude?: number | null; longitude?: number | null; postcode?: string | null } | null; radius?: number | null };

const coord = (postcode: string | null) => (postcode && centroids[postcode as keyof typeof centroids]) || null;
function distance(a: readonly number[], b: readonly number[]) {
  const rad = Math.PI / 180, dLat = ((b[0] ?? 0) - (a[0] ?? 0)) * rad, dLon = ((b[1] ?? 0) - (a[1] ?? 0)) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] ?? 0) * rad) * Math.cos((b[0] ?? 0) * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
export function tradeCovers(trade: Trade, postcode: string | null, region: RegionId): boolean {
  if (!postcode || region === "unknown") return false;
  const target = coord(postcode);
  const origin = trade.origin;
  if (target && origin && Number.isFinite(origin.latitude) && Number.isFinite(origin.longitude) && trade.radius && trade.radius > 0) {
    return trade.radius === 9999 || distance([Number(origin.latitude), Number(origin.longitude)], target) <= trade.radius;
  }
  // Enquiries can contain a postcode + radius instead of a resolved place. Never treat a radius as a whole region.
  for (const label of trade.areas ?? []) {
    const match = label.match(/\bVIC\s+(\d{4})\s+(\d+)\s*km\s*radius/i);
    if (match && target && coord(match[1] ?? null)) {
      const start = coord(match[1] ?? null);
      if (start && distance(start, target) <= Number(match[2])) return true;
    }
  }
  return regionsForDeclaredAreas((trade.areas ?? []).filter((label) => !/\bVIC\s+\d{4}\s+\d+\s*km/i.test(label))).includes(region);
}
/** Office display groups (Jo, 6 Oct 2026). Presentation only; never decides eligibility or assignment. */
export function hotRegion(postcode: string | null): string {
  const n = Number(postcode);
  const r = regionForPostcode(postcode);
  if (r.startsWith("mel_")) return "Melbourne metro";
  if (r === "mornington") return "Mornington Peninsula";
  if (r === "geelong") return "Geelong";
  if (r === "hume") return "Goulburn & Hume";
  if (r === "gippsland") return n >= 3875 && n <= 3909 ? "Far East Gippsland" : "Gippsland";
  if ((n >= 3340 && n <= 3357) || (n >= 3430 && n <= 3448)) return "Ballarat / Macedon";
  if (n >= 3450 && n <= 3599 && !(n >= 3480 && n <= 3509)) return "Bendigo / Loddon";
  return ["ballarat", "wimmera_mallee", "south_west", "bendigo_macedon"].includes(r) ? "Western Victoria" : "Other Victoria";
}
/** Regions with no local trade confirmed yet (Jo, 6 Oct 2026). Leads here are held, never ticked by default. */
export const HOT_HOLD_REGIONS = new Set(["Bendigo / Loddon", "Far East Gippsland"]);
/** Specific jobs Jo excluded (QA, her own tests, 1 m²). */
export const HOT_EXCLUDED_JOBS = new Set(["HV-1059", "HV-1061", "HV-1063", "HV-1257", "HV-1291", "HV-1161", "HV-1437"]);
/** Older duplicate records Jo asked to hide (newest kept). */
export const HOT_HIDDEN_DUPLICATES = new Set(["HV-1225", "HV-1242", "HV-1286", "HV-1475", "HV-1180"]);
/** Automatic/backlog sends must never reach these explicit owner decisions (mirrored in ENQ_00/ENQ_01). */
export function legacyExclusionReason(jobNumber: string | null | undefined): "LEGACY_EXCLUDED" | "HIDDEN_DUPLICATE" | null {
  const n = (jobNumber ?? "").trim();
  if (HOT_EXCLUDED_JOBS.has(n)) return "LEGACY_EXCLUDED";
  if (HOT_HIDDEN_DUPLICATES.has(n)) return "HIDDEN_DUPLICATE";
  return null;
}

const TYPO_DOMAINS = new Set(["gmai.com", "gmial.com", "gmal.com", "gmail.co", "gmail.con", "gnail.com", "hotmial.com", "hotmai.com", "hotmail.con", "outlok.com", "yaho.com", "yahoo.con", "bigpond.con", "iclod.com", "icloud.con"]);
export function emailTypo(email: string | null | undefined): string | null {
  const domain = (email ?? "").trim().toLowerCase().split("@")[1];
  return domain && TYPO_DOMAINS.has(domain) ? `The email domain "${domain}" looks like a typo. Check it with the owner before sending.` : null;
}

export type HotStatus = "not_sent" | "sent" | "spot_saved" | "opted_out";
export function hotStatus(x: { sentAt: string | null; spotSavedAt: string | null; optedOutAt: string | null }): HotStatus {
  if (x.optedOutAt) return "opted_out";
  if (x.spotSavedAt) return "spot_saved";
  return x.sentAt ? "sent" : "not_sent";
}
export const HOT_STATUS_LABEL: Record<HotStatus, string> = { not_sent: "Not sent", sent: "Sent", spot_saved: "Spot saved", opted_out: "Opted out" };

/** Shared-email flags: one owner email covering more than one home. Returns jobNumber -> other job numbers. */
export function sharedEmailFlags(rows: { jobNumber: string | null; email: string | null }[]) {
  const by = new Map<string, string[]>();
  for (const r of rows) { const e = (r.email ?? "").trim().toLowerCase(); if (e && r.jobNumber) by.set(e, [...(by.get(e) ?? []), r.jobNumber]); }
  const out = new Map<string, string[]>();
  for (const list of by.values()) if (list.length > 1) for (const j of list) out.set(j, list.filter((x) => x !== j));
  return out;
}

/** Selection blocker before sending. null = OK. Two homes on the same email: Jo must pick one. */
export function hotSelectionBlocker(selected: { jobNumber: string | null; email: string | null }[]): string | null {
  const seen = new Map<string, string>();
  for (const r of selected) {
    const e = (r.email ?? "").trim().toLowerCase();
    if (!e) continue;
    if (seen.has(e)) return `${seen.get(e)} and ${r.jobNumber} share one email. Pick one home for this email.`;
    seen.set(e, r.jobNumber ?? "");
  }
  return null;
}
export function hotCoverage(postcode: string | null, trades: Trade[]) {
  const region = regionForPostcode(postcode);
  const matches = trades.filter((t) => tradeCovers(t, postcode, region));
  return { installers: [...new Set(matches.filter((t) => t.kind === "installer").map((t) => t.name))], electricians: [...new Set(matches.filter((t) => t.kind === "rec").map((t) => t.name))], checkCoverage: postcode === "3340" || postcode === "3434" };
}
/** Jo (8 Oct 2026): the Save my spot campaign — and ONLY this campaign — may send to real customers,
 *  one press of Send at a time. Every other customer email stays behind the global switch (off). */
// Decision 388 (Jo 25 Oct 2026): HELD until Jo approves the spot-only O1/O2 wording (docs/decision-388-spot-only-wording.md);
// now also gates real sends (realSendingOn, sendInitialEstimateEmail). Set back to true on approval.
export const SAVE_SPOT_REAL_SEND_APPROVED = false as boolean;
/** Jo (9 Oct 2026, "Ok then fix it"): the preserved Group B invitation is approved for real delivery through
 *  its own guarded path only. Global switches, consent, original-media, idempotency and opt-out guards still apply. */
// Decision 388: HELD with SAVE_SPOT_REAL_SEND_APPROVED (the O2 questions email was reworded spot-only).
export const INSULATION_DETAILS_REAL_SEND_APPROVED = false as boolean;
/** Leads Jo may already have emailed by hand: shown with a note so she can untick them. */
export const HOT_MAYBE_EMAILED_BY_HAND: Record<string, string> = { "HV-1114": "Jo may already have emailed this owner by hand. Untick if so." };
