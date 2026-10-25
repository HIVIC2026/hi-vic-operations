// Decision 286 (Jo 25 Oct 2026): the Enquiries list columns are Job · Owner · Address · Size (m²) · Insulation ·
// Estimate ($) · Last heard, and every column heading both sorts and FILTERS (tap a heading: pick values for Insulation
// and Last heard, min/max for Size and Estimate, free text for Job / Owner / Address). No chip panel (285). The single
// search box at the top matches owner, address and job number. Hottest-first default sort, rank never shown (283).
// PURE: labels, filter matching and the estimate label only. No I/O.
import { INSULATION_LABEL, LAST_HEARD_LABEL, type InsulationChip, type LastHeardChip } from "./office-filters.core";

export type EnquiryColumnKey = "job" | "owner" | "address" | "size" | "insulation" | "estimate" | "heard";
export type EnquiryColumn =
  | { key: "job" | "owner" | "address"; label: string; filter: "text" }
  | { key: "size" | "estimate"; label: string; filter: "range"; unit: "m²" | "$" }
  | { key: "insulation"; label: string; filter: "pick"; options: readonly InsulationChip[]; labels: Record<InsulationChip, string> }
  | { key: "heard"; label: string; filter: "pick"; options: readonly LastHeardChip[]; labels: Record<LastHeardChip, string> };

export const ENQUIRY_COLUMNS: readonly EnquiryColumn[] = [
  { key: "job", label: "Job", filter: "text" },
  { key: "owner", label: "Owner", filter: "text" },
  { key: "address", label: "Address", filter: "text" },
  { key: "size", label: "Size (m²)", filter: "range", unit: "m²" },
  { key: "insulation", label: "Insulation", filter: "pick", options: ["no", "some", "not_sure"], labels: INSULATION_LABEL },
  { key: "estimate", label: "Estimate", filter: "range", unit: "$" },
  { key: "heard", label: "Last heard", filter: "pick", options: ["today", "week", "older", "never"], labels: LAST_HEARD_LABEL },
];

export type Range = { min?: number | undefined; max?: number | undefined };
export type ColumnFilters = {
  job?: string | undefined; owner?: string | undefined; address?: string | undefined;
  size?: Range | undefined; estimate?: Range | undefined;
  insulation?: InsulationChip[] | undefined; heard?: LastHeardChip[] | undefined;
};

/** What a row offers the column filters (the list row carries these). */
export type ColumnRow = {
  jobNumber: string; ownerName: string; address: string; areaM2: number | null; insulation: InsulationChip;
  estimateDollars: number | null; heard: LastHeardChip;
};

const has = (s: string | undefined) => !!s && s.trim().length > 0;
const inRange = (v: number | null, r: Range | undefined) => {
  if (!r || (r.min == null && r.max == null)) return true;
  if (v == null) return false;
  return (r.min == null || v >= r.min) && (r.max == null || v <= r.max);
};
const textHit = (hay: string, needle: string | undefined) => !has(needle) || hay.toLowerCase().includes(needle!.trim().toLowerCase());

export function matchesColumnFilters(r: ColumnRow, f: ColumnFilters): boolean {
  return textHit(r.jobNumber, f.job) && textHit(r.ownerName, f.owner) && textHit(r.address, f.address)
    && inRange(r.areaM2, f.size) && inRange(r.estimateDollars, f.estimate)
    && (!f.insulation?.length || f.insulation.includes(r.insulation)) && (!f.heard?.length || f.heard.includes(r.heard));
}

/** Which columns carry a filter right now (for the heading mark and the "Clear" affordance). */
export function activeColumnFilters(f: ColumnFilters): EnquiryColumnKey[] {
  const out: EnquiryColumnKey[] = [];
  if (has(f.job)) out.push("job");
  if (has(f.owner)) out.push("owner");
  if (has(f.address)) out.push("address");
  if (f.size && (f.size.min != null || f.size.max != null)) out.push("size");
  if (f.insulation?.length) out.push("insulation");
  if (f.estimate && (f.estimate.min != null || f.estimate.max != null)) out.push("estimate");
  if (f.heard?.length) out.push("heard");
  return out;
}

/** One line for the Address column: "12 Wattle St, Clayton 3168" (blank parts simply left out). */
export function addressLine(a: { street: string; suburb: string; postcode: string }): string {
  const town = [a.suburb, a.postcode].filter(Boolean).join(" ");
  return [a.street, town].filter(Boolean).join(", ");
}

export type EstimateFacts = { websiteTotal: number | null; quoteTotal: number | null };
/** Estimate column: the quoted price when a quote exists, else the website estimate. */
export function estimateDollars(e: EstimateFacts): { dollars: number | null; kind: "quote" | "website" | null } {
  if (e.quoteTotal != null && Number.isFinite(e.quoteTotal)) return { dollars: e.quoteTotal, kind: "quote" };
  if (e.websiteTotal != null && Number.isFinite(e.websiteTotal)) return { dollars: e.websiteTotal, kind: "website" };
  return { dollars: null, kind: null };
}
export function estimateLabel(e: { dollars: number | null; kind: "quote" | "website" | null }): string {
  if (e.dollars == null) return "—";
  const money = `$${Math.round(e.dollars).toLocaleString("en-AU")}`;
  return e.kind === "quote" ? `${money} quoted` : money;
}

/** Size column: "~120 m²" or "—". */
export const sizeLabel = (areaM2: number | null) => (areaM2 != null && areaM2 > 0 ? `~${Math.round(areaM2)} m²` : "—");
