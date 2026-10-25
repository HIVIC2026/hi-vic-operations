// Office list filters, sorting and the Enquiries priority rank (decisions 225, 226, 228; O3/O4 approved).
// PURE: chips on every column (multi-select), every column sortable, and the Enquiries priority rank (hottest first:
// no insulation, size known, recent contact, in a covered area) — decision 283: used only to sort, never shown. No I/O.
import { regionForPostcode } from "./coverage-regions.core";

export type InsulationChip = "no" | "some" | "not_sure";
export type SizeChip = "under_100" | "100_150" | "over_150" | "none";
export type LastHeardChip = "today" | "week" | "older" | "never";
export type SourceChip = "website" | "email" | "phone" | "installer";
export type RegionChip = "inner" | "east" | "south_east" | "north" | "west" | "regional";

export const INSULATION_LABEL: Record<InsulationChip, string> = { no: "No", some: "Some", not_sure: "Not sure" };
export const SIZE_LABEL: Record<SizeChip, string> = { under_100: "Under 100 m²", "100_150": "100–150 m²", over_150: "Over 150 m²", none: "No size" };
export const LAST_HEARD_LABEL: Record<LastHeardChip, string> = { today: "Today", week: "This week", older: "Older", never: "Never" };
export const SOURCE_LABEL: Record<SourceChip, string> = { website: "Website", email: "Email", phone: "Phone", installer: "Installer" };
export const REGION_LABEL: Record<RegionChip, string> = { inner: "Inner Melbourne", east: "Eastern suburbs", south_east: "South-east", north: "North", west: "West", regional: "Regional" };

const DAY = 86_400_000;

/** Owner's website answer ("none" | "present" | "unknown") → the Insulation chip. */
export function insulationChip(declared: string | null | undefined): InsulationChip {
  return declared === "none" ? "no" : declared === "present" ? "some" : "not_sure";
}
export function sizeChip(areaM2: number | null | undefined): SizeChip {
  if (areaM2 == null || !Number.isFinite(areaM2) || areaM2 <= 0) return "none";
  return areaM2 < 100 ? "under_100" : areaM2 <= 150 ? "100_150" : "over_150";
}
/** Melbourne calendar day comparison so "Today" means today in Victoria. */
const melDay = (ms: number) => new Date(ms).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" });
export function lastHeardChip(at: string | null | undefined, now: number): LastHeardChip {
  if (!at) return "never";
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return "never";
  if (melDay(t) === melDay(now)) return "today";
  return now - t <= 7 * DAY ? "week" : "older";
}
/** Website = signed Base44 intake; Email = created from the owner's email (decision 255); Phone = entered by the office (New enquiry); Installer = installer-sourced job. */
export function sourceChip(j: { source: string | null; channel: string | null }): SourceChip {
  if (j.channel === "installer_sourced") return "installer";
  return j.source === "base44" ? "website" : j.source === "email" ? "email" : "phone";
}

/** Suburb / area chip from the SAME postcode regions as Partners › Coverage (coverage-regions.core, decision 229). */
export function regionChip(postcode: string | null | undefined): RegionChip | null {
  const r = regionForPostcode(postcode);
  if (r === "unknown") return null;
  if (r === "mel_east") return "east";
  if (r === "mel_south_east" || r === "mornington") return "south_east";
  if (r === "mel_north") return "north";
  if (r === "mel_west") return "west";
  if (r === "mel_inner") return "inner";
  return "regional";
}

export type ChipFilters = {
  insulation?: InsulationChip[] | undefined; size?: SizeChip[] | undefined; region?: RegionChip[] | undefined; source?: SourceChip[] | undefined; heard?: LastHeardChip[] | undefined;
  stage?: string[] | undefined; installer?: string[] | undefined; suburb?: string | undefined; ownJobs?: boolean | undefined;
};
export type FilterableRow = {
  insulation: InsulationChip; size: SizeChip; region: RegionChip | null; source: SourceChip; heard: LastHeardChip;
  stage?: string | null; installer?: string | null; suburb?: string | null; ownJob?: boolean;
};

/** Multi-select: a column with nothing ticked does not filter; ticks within one column are OR, across columns AND. */
export function matchesChips(r: FilterableRow, f: ChipFilters): boolean {
  const pick = <T,>(sel: T[] | undefined, v: T | null | undefined) => !sel?.length || (v != null && sel.includes(v));
  if (!pick(f.insulation, r.insulation) || !pick(f.size, r.size) || !pick(f.region, r.region) || !pick(f.source, r.source) || !pick(f.heard, r.heard)) return false;
  if (!pick(f.stage, r.stage ?? null)) return false;
  if (f.installer?.length && !f.installer.includes(r.installer ?? "none")) return false;
  if (f.suburb?.trim() && !(r.suburb ?? "").toLowerCase().includes(f.suburb.trim().toLowerCase())) return false;
  if (f.ownJobs && !r.ownJob) return false;
  return true;
}

/** Priority facts for one enquiry (decision 225: hottest first). */
export type PriorityFacts = { insulation: InsulationChip; areaM2: number | null; lastHeardAt: string | null; covered: boolean | null; createdAt: string };
export const PRIORITY_RECENT_DAYS = 7;

/** Score: no insulation 8 · size known 4 · recent contact (≤ 7 days) 2 · covered area 1. Higher = hotter. */
export function priorityScore(p: PriorityFacts, now: number): number {
  const recent = !!p.lastHeardAt && now - Date.parse(p.lastHeardAt) <= PRIORITY_RECENT_DAYS * DAY;
  return (p.insulation === "no" ? 8 : 0) + (sizeChip(p.areaM2) !== "none" ? 4 : 0) + (recent ? 2 : 0) + (p.covered ? 1 : 0);
}

/** Rank 1..n, hottest first — used only to order the list, never shown (decision 283). Ties: newest enquiry first, then id. */
export function rankByPriority<T extends PriorityFacts & { id: string }>(rows: T[], now: number): (T & { priority: number; score: number })[] {
  return rows
    .map((r) => ({ ...r, score: priorityScore(r, now) }))
    .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
    .map((r, i) => ({ ...r, priority: i + 1 }));
}

export type SortDir = "asc" | "desc";
/** Every column sortable: nulls last in both directions; stable tie-break on id. */
export function sortRows<T extends { id: string }>(rows: T[], key: keyof T, dir: SortDir): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x == null && y == null) return a.id.localeCompare(b.id);
    if (x == null) return 1;
    if (y == null) return -1;
    const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en-AU", { numeric: true, sensitivity: "base" });
    return c * sign || a.id.localeCompare(b.id);
  });
}

/** Parses "a,b,c" URL params into a whitelisted list. */
export function parseList<T extends string>(raw: unknown, allowed: readonly T[]): T[] {
  if (typeof raw !== "string" || !raw) return [];
  return [...new Set(raw.split(",").filter((v): v is T => (allowed as readonly string[]).includes(v)))];
}
export const INSULATION_CHIPS = ["no", "some", "not_sure"] as const;
export const SIZE_CHIPS = ["under_100", "100_150", "over_150", "none"] as const;
export const REGION_CHIPS = ["east", "south_east", "north", "west", "inner", "regional"] as const;
export const SOURCE_CHIPS = ["website", "email", "phone", "installer"] as const;
export const HEARD_CHIPS = ["today", "week", "older", "never"] as const;

/** Page of 50 (same size as the database enquiry page). */
export function pageOf<T>(rows: T[], page: number, size = 50) {
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(Math.max(1, page), totalPages);
  return { rows: rows.slice((current - 1) * size, current * size), page: current, totalPages, total: rows.length, pageSize: size };
}
