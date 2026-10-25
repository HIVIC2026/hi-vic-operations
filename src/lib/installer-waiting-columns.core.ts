// Decision 378 (Jo 25 Oct 2026): our-lead jobs WAITING FOR AN INSTALLER (spot saved, the office must "Choose installer")
// in ONE table with the Enquiries interaction (decisions 281/283/285/286): every heading sorts AND filters, one search
// box, no chip panel. Columns Job · Owner · Suburb (postcode) · Size · Insulation · Estimate · Waiting since · Coverage,
// then the "Choose installer" button (the existing flow, unchanged). Default sort: waiting longest first.
// Coverage (added to 378 the same day): per job postcode, is there an approved INSTALLER and an approved ELECTRICIAN
// (REC with an active PIESA rate) covering it — the same area rules the offer / automatic-offer readers apply
// (approved + active, current verified documents, verified coverage incl. the postcode, not paused, takes our leads,
// TEST partners only for TEST jobs). Per-day availability and crew clearance are still checked when an offer is made.
// Membership is the Needs me "Choose installer" rule (`readyCheckOfficeItem`): our lead at ready_check_ready_to_schedule,
// no installer, no offer pending/accepted. Needs me folds those rows into ONE link to this list (one pile per job).
// PURE: no I/O.
import { has, inRange, textHit, type ListColumn, type Range } from "./enquiry-columns.core";
import { INSULATION_LABEL, type InsulationChip, type SortDir } from "./office-filters.core";
import { coveragePartnerBlocker, type CoveragePartner } from "./coverage.core";
import { isElectricianBiz, isInstallerBiz, verifiedServiceAreaMatch } from "./pilot.core";
import { partnerAllowedForJob } from "./test-send.core";
import { readyCheckOfficeItem, type OfficeOfferRow } from "./ready-check-times.core";
import type { NeedsRow } from "./office-needs.core";
import type { SpotReleaseStateName } from "./spot-release.core";

export const INSTALLER_WAITING_PATH = "/admin/jobs/choose-installer" as const;

export type WaitingAge = "today" | "week" | "older";
export const WAITING_AGES = ["today", "week", "older"] as const;
export const WAITING_AGE_LABEL: Record<WaitingAge, string> = { today: "Under a day", week: "1–7 days", older: "Over a week" };

export type CoverageChip = "no_installer" | "no_electrician" | "both";
export const COVERAGE_CHIPS = ["no_installer", "no_electrician", "both"] as const;
export const COVERAGE_LABEL: Record<CoverageChip, string> = { no_installer: "No installer", no_electrician: "No electrician", both: "Both covered" };

export type WaitingColumnKey = "job" | "owner" | "suburb" | "size" | "insulation" | "estimate" | "waiting" | "coverage";
export const INSTALLER_WAITING_COLUMNS: readonly (ListColumn & { key: WaitingColumnKey })[] = [
  { key: "job", label: "Job", filter: "text" },
  { key: "owner", label: "Owner", filter: "text" },
  { key: "suburb", label: "Suburb (postcode)", filter: "text" },
  { key: "size", label: "Size (m²)", filter: "range", unit: "m²" },
  { key: "insulation", label: "Insulation", filter: "pick", options: ["no", "some", "not_sure"], labels: INSULATION_LABEL },
  { key: "estimate", label: "Estimate", filter: "range", unit: "$" },
  { key: "waiting", label: "Waiting since", filter: "pick", options: WAITING_AGES, labels: WAITING_AGE_LABEL, sortLabels: ["Longest first", "Newest first"] },
  { key: "coverage", label: "Coverage", filter: "pick", options: COVERAGE_CHIPS, labels: COVERAGE_LABEL, sortLabels: ["Gaps first", "Covered first"] },
];

export type WaitingCoverage = { installer: boolean; electrician: boolean };
export type InstallerWaitingRow = {
  id: string; jobNumber: string; ownerName: string; suburb: string; postcode: string;
  areaM2: number | null; areaKind: "measured" | "website" | null; insulation: InsulationChip;
  estimateDollars: number | null;
  /** Spot saved time; null only when no saved spot is recorded (then `waitingFrom` is the job's creation). */
  spotSavedAt: string | null; waitingFrom: string;
  coverage: WaitingCoverage;
  /** The last Ready Check offer came back (declined / no times in 24h) — the office chooses again. */
  lastOffer: { status: "declined" | "expired"; name: string | null } | null;
  isTest: boolean;
  /** Decision 389: the release state — "Released to X · waiting for owner since …", "Owner confirmed — choose installer",
   *  "Didn't confirm after release…". A pending release is NOT available to release again. */
  release?: { state: SpotReleaseStateName; line: string | null; releasable: boolean } | undefined;
};

export type WaitingFilters = {
  job?: string | undefined; owner?: string | undefined; suburb?: string | undefined;
  size?: Range | undefined; estimate?: Range | undefined;
  insulation?: InsulationChip[] | undefined; waiting?: WaitingAge[] | undefined; coverage?: CoverageChip[] | undefined;
};

const DAY = 86_400_000;

export function waitingAge(fromIso: string, now: number): WaitingAge {
  const ms = now - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < DAY) return "today";
  return ms <= 7 * DAY ? "week" : "older";
}

/** "3 days · 22 Oct" / "5 hours · 25 Oct" / "just now · 25 Oct". */
export function waitingSinceLabel(fromIso: string, now: number): { relative: string; date: string } {
  const ms = now - Date.parse(fromIso);
  const date = Number.isFinite(Date.parse(fromIso)) ? new Date(fromIso).toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "Australia/Melbourne" }) : "";
  if (!Number.isFinite(ms)) return { relative: "—", date };
  if (ms < 3_600_000) return { relative: "just now", date };
  if (ms < DAY) { const h = Math.floor(ms / 3_600_000); return { relative: `${h} hour${h === 1 ? "" : "s"}`, date }; }
  const d = Math.floor(ms / DAY);
  return { relative: `${d} day${d === 1 ? "" : "s"}`, date };
}

/** "Clayton (3168)", "Clayton", "(3168)" or "—". */
export function suburbLabel(r: { suburb: string; postcode: string }): string {
  const s = r.suburb.trim(), p = r.postcode.trim();
  if (s && p) return `${s} (${p})`;
  return s || (p ? `(${p})` : "—");
}

export function coverageChip(c: WaitingCoverage): CoverageChip[] {
  const out: CoverageChip[] = [];
  if (!c.installer) out.push("no_installer");
  if (!c.electrician) out.push("no_electrician");
  if (c.installer && c.electrician) out.push("both");
  return out;
}
/** Gaps first when ascending: neither 0 · electrician only 1 · installer only 2 · both 3. */
export const coverageRank = (c: WaitingCoverage) => (c.installer ? 2 : 0) + (c.electrician ? 1 : 0);

export function matchesWaitingFilters(r: InstallerWaitingRow, f: WaitingFilters, now: number): boolean {
  return textHit(r.jobNumber, f.job) && textHit(r.ownerName, f.owner) && textHit(`${r.suburb} ${r.postcode}`, f.suburb)
    && inRange(r.areaM2, f.size) && inRange(r.estimateDollars, f.estimate)
    && (!f.insulation?.length || f.insulation.includes(r.insulation))
    && (!f.waiting?.length || f.waiting.includes(waitingAge(r.waitingFrom, now)))
    && (!f.coverage?.length || coverageChip(r.coverage).some((c) => f.coverage!.includes(c)));
}

export function activeWaitingFilters(f: WaitingFilters): WaitingColumnKey[] {
  const out: WaitingColumnKey[] = [];
  if (has(f.job)) out.push("job");
  if (has(f.owner)) out.push("owner");
  if (has(f.suburb)) out.push("suburb");
  if (f.size && (f.size.min != null || f.size.max != null)) out.push("size");
  if (f.insulation?.length) out.push("insulation");
  if (f.estimate && (f.estimate.min != null || f.estimate.max != null)) out.push("estimate");
  if (f.waiting?.length) out.push("waiting");
  if (f.coverage?.length) out.push("coverage");
  return out;
}

/** The one search box: owner, suburb, postcode, job number. */
export function matchesWaitingSearch(r: InstallerWaitingRow, q: string): boolean {
  const n = q.trim().toLowerCase();
  return !n || [r.jobNumber, r.ownerName, r.suburb, r.postcode].join(" ").toLowerCase().includes(n);
}

const INSULATION_ORDER: Record<InsulationChip, number> = { no: 0, some: 1, not_sure: 2 };
const sortValue = (r: InstallerWaitingRow, k: WaitingColumnKey): string | number | null => {
  switch (k) {
    case "job": return r.jobNumber;
    case "owner": return r.ownerName.trim() ? r.ownerName.toLowerCase() : null;
    case "suburb": return r.suburb.trim() ? r.suburb.toLowerCase() : r.postcode || null;
    case "size": return r.areaM2;
    case "insulation": return INSULATION_ORDER[r.insulation];
    case "estimate": return r.estimateDollars;
    case "waiting": return Date.parse(r.waitingFrom);
    case "coverage": return coverageRank(r.coverage);
  }
};

/** Sort: blanks always last; ties keep the longest-waiting first. Default = Waiting since, longest first. */
export function sortWaiting(rows: InstallerWaitingRow[], key: string, dir: SortDir): InstallerWaitingRow[] {
  const k = (INSTALLER_WAITING_COLUMNS.some((c) => c.key === key) ? key : "waiting") as WaitingColumnKey;
  const sign = dir === "desc" ? -1 : 1;
  return [...rows].sort((a, b) => {
    const x = sortValue(a, k), y = sortValue(b, k);
    if (x == null && y != null) return 1;
    if (y == null && x != null) return -1;
    if (x != null && y != null && x !== y) return (x < y ? -1 : 1) * sign;
    return Date.parse(a.waitingFrom) - Date.parse(b.waitingFrom) || a.id.localeCompare(b.id);
  });
}

/** Search + column filters + sort in one go (the screen calls this; the loader returns every waiting job). */
export function waitingView(rows: InstallerWaitingRow[], p: { search: string; filters: WaitingFilters; sort: string; dir: SortDir }, now: number): InstallerWaitingRow[] {
  return sortWaiting(rows.filter((r) => matchesWaitingSearch(r, p.search) && matchesWaitingFilters(r, p.filters, now)), p.sort || "waiting", p.sort ? p.dir : "asc");
}

// ---- membership ---------------------------------------------------------------------------------------------------

export type WaitingJobFacts = {
  channel: string | null; stage: string; deleted: boolean; archived: boolean; hasInstaller: boolean; offers: OfficeOfferRow[];
};
/** Same rule as the Needs me "Choose installer" item; returns the last-offer note when an offer came back. */
export function installerWaiting(f: WaitingJobFacts): { lastOffer: InstallerWaitingRow["lastOffer"] } | null {
  if (f.deleted || f.archived) return null;
  const item = readyCheckOfficeItem({ channel: f.channel, stage: f.stage, hasInstaller: f.hasInstaller, offers: f.offers });
  if (!item) return null;
  return { lastOffer: item.code === "offer_returned" ? { status: item.status, name: item.name } : null };
}

/** Size column: measured (current Ready Check measurement) beats the website estimate. */
export function waitingSize(f: { measuredM2: number | null; savedM2: number | null; estimatedM2: number | null }): { areaM2: number | null; areaKind: InstallerWaitingRow["areaKind"] } {
  const ok = (n: number | null) => n != null && Number.isFinite(n) && n > 0;
  if (ok(f.measuredM2)) return { areaM2: f.measuredM2, areaKind: "measured" };
  if (ok(f.savedM2)) return { areaM2: f.savedM2, areaKind: "website" };
  if (ok(f.estimatedM2)) return { areaM2: f.estimatedM2, areaKind: "website" };
  return { areaM2: null, areaKind: null };
}

// ---- coverage -----------------------------------------------------------------------------------------------------

export type WaitingPartner = CoveragePartner & {
  accepting_new_jobs?: boolean | null; receives_hivic_leads?: boolean | null; onboarding_notes?: string | null;
  /** RECs: an ACTIVE PIESA rate in its effective window (selectAgreedRate). */
  piesaRate?: boolean;
  /** RECs: approved, not-removed electrician workers. */
  approvedElectricians?: number;
};

/** The partner may be offered work at this postcode (area rules shared with the offer readers). */
export function partnerCoversJob(p: WaitingPartner, trade: "installer" | "electrician", site: { postcode: string | null; isTest: boolean }, now = new Date()): boolean {
  if (trade === "installer" ? !isInstallerBiz(p) : !isElectricianBiz(p)) return false;
  if (!partnerAllowedForJob(p, site.isTest ? "qa_test" : null)) return false;
  if (coveragePartnerBlocker(p, trade === "installer" ? "installer" : "rec", now)) return false;
  if (p.accepting_new_jobs === false || p.receives_hivic_leads === false) return false;
  if (!verifiedServiceAreaMatch(p, site.postcode)) return false;
  if (trade === "installer") return p.free_measureups_for_hivic_quote_leads === true;
  return p.piesaRate === true && (p.approvedElectricians ?? 0) > 0;
}

/** One pass for every postcode on the page (cached per postcode + TEST/live). */
export function coverageLookup(partners: WaitingPartner[], now = new Date()): (postcode: string | null, isTest: boolean) => WaitingCoverage {
  const cache = new Map<string, WaitingCoverage>();
  return (postcode, isTest) => {
    const k = `${postcode ?? ""}|${isTest ? 1 : 0}`;
    let c = cache.get(k);
    if (!c) {
      c = { installer: partners.some((p) => partnerCoversJob(p, "installer", { postcode, isTest }, now)), electrician: partners.some((p) => partnerCoversJob(p, "electrician", { postcode, isTest }, now)) };
      cache.set(k, c);
    }
    return c;
  };
}

/** Button / note when no installer covers the job (the Choose installer list would otherwise be empty). */
export const NO_INSTALLER_NOTE = "No installer covers this area";
export const noInstallerExplain = (r: { suburb: string; postcode: string }) =>
  `No approved installer has verified coverage for ${suburbLabel(r) === "—" ? "this address" : suburbLabel(r)}. Add the postcode to an installer's coverage in Partners › Coverage, or onboard an installer there; you can still look at installers outside their listed area.`;

// ---- Needs me link -------------------------------------------------------------------------------------------------

/** Needs me keeps one pile per job: its "Spot saved · waiting for an installer" rows fold into ONE link to this list. */
export function foldChooseInstaller(rows: NeedsRow[]): { rows: NeedsRow[]; chooseInstaller: NeedsRow[] } {
  return { rows: rows.filter((r) => r.kind !== "choose_installer"), chooseInstaller: rows.filter((r) => r.kind === "choose_installer") };
}
export const chooseInstallersLinkLabel = (n: number) => `Choose installers (${n})`;
