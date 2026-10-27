// Decision 378 (Jo 25 Oct 2026): our-lead jobs WAITING FOR AN INSTALLER (spot saved, the office must "Choose installer")
// in ONE table with the Enquiries interaction (decisions 281/283/285/286): every heading sorts AND filters, one search
// box, no chip panel. Columns Job · Owner · Suburb (postcode) · Size · Insulation · Estimate · Waiting since · Coverage,
// then the "Choose installer" button (the existing flow, unchanged). Default sort: waiting longest first.
// Coverage (added to 378 the same day): per job postcode, "Installer ✓" = the Choose installer pop-up has at least one
// installer it can Release to (`installerCanBeOffered` → readycheck-booking.core `installerOfferable`, the pop-up's own
// rule: approved + active, documents, a Full-certified installer, free Ready Checks, takes work, verified coverage).
// "Electrician ✓" = an approved REC with an active PIESA rate and an approved electrician covers it (approved + active,
// current verified documents, verified coverage incl. the postcode, not paused, takes our leads) — information for the
// later PIESA step only; it never affects choosing an installer. TEST partners only for TEST jobs.
// Membership is the Needs me "Choose installer" rule (`readyCheckOfficeItem`): our lead at ready_check_ready_to_schedule,
// no installer, no offer pending/accepted. Needs me folds those rows into ONE link to this list (one pile per job).
// PURE: no I/O.
import { has, inRange, textHit, type ListColumn, type Range } from "./enquiry-columns.core";
import { INSULATION_LABEL, REGION_CHIPS, regionChip, type InsulationChip, type RegionChip, type SortDir } from "./office-filters.core";
import { coveragePartnerBlocker, type CoveragePartner } from "./coverage.core";
import { isElectricianBiz, isInstallerBiz, verifiedServiceAreaMatch } from "./pilot.core";
import { installerCandidate, installerOfferable } from "./readycheck-booking.core";
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

/** An installer business with the facts the Ready Check offer rule reads (readycheck-booking.server `installerOfferFacts`). */
export type WaitingInstaller = {
  id: string; name: string; is_active: boolean; onboarding_status: string;
  accepting_new_jobs: boolean | null; receives_hivic_leads: boolean | null; coverage_verified_at: string | null;
  service_postcodes: string[] | null; free_measureups_for_hivic_quote_leads: boolean | null; onboarding_notes: string | null;
  credentialsOk: boolean; fullCertifiedInstallers: number;
};
/** "Installer ✓" = the Choose installer pop-up has at least one installer it can Release to here — the same
 *  `installerOfferable` rule the pop-up uses (HV-1509). Per-day availability is not known before the owner's times. */
export function installerCanBeOffered(i: WaitingInstaller, site: { postcode: string | null; isTest: boolean }): boolean {
  if (!partnerAllowedForJob(i, site.isTest ? "qa_test" : null)) return false;
  const pc = site.postcode;
  return installerOfferable(installerCandidate({
    business_id: i.id, name: i.name, is_active: i.is_active, onboarding_status: i.onboarding_status,
    accepting_new_jobs: i.accepting_new_jobs, receives_hivic_leads: i.receives_hivic_leads,
    coverage_verified: !!i.coverage_verified_at, covers_postcode: verifiedServiceAreaMatch(i, pc), exact_postcode: !!pc && !!i.service_postcodes?.includes(pc),
    credentialsOk: i.credentialsOk, fullCertifiedInstallers: i.fullCertifiedInstallers, freeMeasureUps: i.free_measureups_for_hivic_quote_leads,
    weekly_capacity: null, open_jobs: 0, recent_offers_30d: 0, acceptance_rate: null, free_in_window: null,
  }));
}

/** One pass for every postcode on the page (cached per postcode + TEST/live). Installer = `installerCanBeOffered`. */
export function coverageLookup(partners: WaitingPartner[], now = new Date(), installers: WaitingInstaller[] = []): (postcode: string | null, isTest: boolean) => WaitingCoverage {
  const cache = new Map<string, WaitingCoverage>();
  return (postcode, isTest) => {
    const k = `${postcode ?? ""}|${isTest ? 1 : 0}`;
    let c = cache.get(k);
    if (!c) {
      c = { installer: installers.some((i) => installerCanBeOffered(i, { postcode, isTest })), electrician: partners.some((p) => partnerCoversJob(p, "electrician", { postcode, isTest }, now)) };
      cache.set(k, c);
    }
    return c;
  };
}

/** Button / note when no installer can be offered the job (the Choose installer list would otherwise be empty). */
export const NO_INSTALLER_NOTE = "No installer can take this area";
export const noInstallerExplain = (r: { suburb: string; postcode: string }) =>
  `No installer can be offered ${suburbLabel(r) === "—" ? "this address" : suburbLabel(r)} right now: none covers it, or the ones that do are blocked (for example no Full-certified installer, a document out of date, or not taking work). Fix it in Partners › Coverage, or show installers anyway to see each one's reason.`;

// ---- header count ---------------------------------------------------------------------------------------------------

/** Every row is on this list; only `toChoose` is on Needs me's "Choose installers" link. Released (waiting for the
 *  owner, decision 389) and came-back (offer declined / not answered, or owner didn't confirm) jobs have their own Needs me
 *  row or none, so Needs me doesn't count them there (one pile per job). */
export function waitingCounts(rows: InstallerWaitingRow[]): { all: number; toChoose: number; released: number; cameBack: number } {
  let released = 0, cameBack = 0;
  for (const r of rows) {
    if (r.release && !r.release.releasable) released++;
    else if (r.lastOffer || r.release?.state === "lapsed") cameBack++;
  }
  return { all: rows.length, toChoose: rows.length - released - cameBack, released, cameBack };
}
export function waitingCountLine(c: ReturnType<typeof waitingCounts>): string {
  const n = (x: number) => x.toLocaleString("en-AU");
  return [
    `${n(c.all)} waiting for an installer`, `${n(c.toChoose)} to choose (the Needs me count)`,
    c.released ? `${n(c.released)} released, waiting for the owner` : null, c.cameBack ? `${n(c.cameBack)} came back` : null,
  ].filter(Boolean).join(" · ");
}

// ---- tabs, areas and recruiting (Jo 26–27 Oct 2026) ------------------------------------------------------------------
// Jo: "filter by suburb etc so we can group jobs together" (on Jobs, "because it's only applicable once they save a
// spot"); "tell which jobs we have an installer and electrician available in so saved spots without them in the area can
// be flagged and we can onboard some people"; released spots get their own tab ("Its own tab", 27 Oct).

/** To release = everything not released and waiting for the owner; Waiting for owner = released, not confirmed yet. */
export type WaitingTab = "to_release" | "waiting_owner";
export const isWaitingOwner = (r: InstallerWaitingRow) => !!r.release && !r.release.releasable;
export const inWaitingTab = (r: InstallerWaitingRow, t: WaitingTab) => (t === "waiting_owner") === isWaitingOwner(r);

/** The area a job sits in, from its postcode (the same areas as Jobs › Active's Suburb / area filter). */
export const areaOf = (r: { postcode: string }): RegionChip | null => regionChip(r.postcode || null);
export type WaitingArea = RegionChip | "everywhere";
export const inArea = (r: InstallerWaitingRow, a: WaitingArea) => a === "everywhere" || areaOf(r) === a;
/** How many jobs in each area, in the usual area order; areas with none are left out. */
export function areaCounts(rows: InstallerWaitingRow[]): { area: RegionChip; n: number }[] {
  const n = new Map<RegionChip, number>();
  for (const r of rows) { const a = areaOf(r); if (a) n.set(a, (n.get(a) ?? 0) + 1); }
  return REGION_CHIPS.filter((a) => n.has(a)).map((a) => ({ area: a, n: n.get(a)! }));
}

/** What a job is missing nearby, in words; null when an approved installer AND electrician both cover it. */
export function coverageGap(c: WaitingCoverage): string | null {
  if (c.installer && c.electrician) return null;
  return !c.installer && !c.electrician ? "No installer or electrician" : !c.installer ? "No installer" : "No electrician";
}
/** Areas to recruit in: saved spots with a coverage gap, one line per suburb (postcode), most jobs first. */
export function recruitAreas(rows: InstallerWaitingRow[]): { place: string; n: number; missing: string }[] {
  const by = new Map<string, { place: string; n: number; installer: boolean; electrician: boolean }>();
  for (const r of rows) {
    if (!coverageGap(r.coverage)) continue;
    const place = suburbLabel(r) === "—" ? "Address not known" : [r.suburb.trim(), r.postcode.trim()].filter(Boolean).join(" ");
    const g = by.get(place) ?? { place, n: 0, installer: false, electrician: false };
    g.n++; g.installer ||= !r.coverage.installer; g.electrician ||= !r.coverage.electrician;
    by.set(place, g);
  }
  return [...by.values()].sort((a, b) => b.n - a.n || a.place.localeCompare(b.place))
    .map((g) => ({ place: g.place, n: g.n, missing: coverageGap({ installer: !g.installer, electrician: !g.electrician })! }));
}

// ---- Choose installer pop-up ----------------------------------------------------------------------------------------

export const CHOOSE_LOAD_FAILED = "Couldn't load installers";
/** The pop-up never goes blank: a failed read says so (with Try again) instead of showing nothing. */
export const choosePanelState = (q: { isError: boolean; hasData: boolean }): "error" | "loading" | "ready" =>
  q.hasData ? "ready" : q.isError ? "error" : "loading";

// ---- Needs me link -------------------------------------------------------------------------------------------------

/** Needs me keeps one pile per job: its "Spot saved · waiting for an installer" rows fold into ONE link to this list. */
export function foldChooseInstaller(rows: NeedsRow[]): { rows: NeedsRow[]; chooseInstaller: NeedsRow[] } {
  return { rows: rows.filter((r) => r.kind !== "choose_installer"), chooseInstaller: rows.filter((r) => r.kind === "choose_installer") };
}
export const chooseInstallersLinkLabel = (n: number) => `Choose installers (${n})`;
