// Decision 246 (Jo 24 Oct 2026): automatic offers by coverage, two switches, both OFF until Jo turns them on.
// "Automatic installer offers": the Choose installer offer goes to ONE approved installer whose Coverage includes
// the postcode, picked by fewest active jobs then nearest. "Automatic electrician offers": the PIESA offer goes to
// the installer's usual electrician (approved REC), else the nearest approved REC whose coverage includes the
// postcode. Each offer is open 24h; on "Not for me"/lapse the next match gets it; after 2 misses the job comes back
// to the office (Needs me "Choose again"). With a switch off the office picks as today (decisions 49, 157, 220).
// Pure rules only: who gets the next automatic offer, or why nobody does. The existing guarded offer senders
// (officePickReadyCheckInstaller / startPiesaAllocation) still check every gate before anything is written.

export type AutoOfferKind = "ready_check" | "piesa";
export const AUTO_OFFER_OPEN_HOURS = 24;
export const AUTO_OFFER_MAX_MISSES = 2;
/** partner_offers.summary flag on an automatic offer (alongside office_choice, so Needs me treats a returned one as "choose again"). */
export const AUTO_OFFER_FLAG = "auto_offer";
export const AUTO_OFFER_SENT_EVENT = "auto_offer_sent";
export const AUTO_OFFER_RETURNED_EVENT = "auto_offer_returned_to_office";
/** workflow_settings switch per kind (Settings › Switches). Missing column / unreadable row = OFF. */
export const AUTO_OFFER_SWITCH: Record<AutoOfferKind, "auto_installer_offers" | "auto_electrician_offers"> = {
  ready_check: "auto_installer_offers", piesa: "auto_electrician_offers",
};
export const AUTO_OFFER_KIND_LABEL: Record<AutoOfferKind, string> = { ready_check: "Ready Check (installer)", piesa: "PIESA (electrician)" };

/** Fails closed: only an explicit boolean true turns a switch on. */
export function autoOfferSwitchOn(row: Record<string, unknown> | null | undefined, kind: AutoOfferKind): boolean {
  return !!row && row[AUTO_OFFER_SWITCH[kind]] === true;
}

export function autoOfferExpiry(now: Date = new Date()): string {
  return new Date(now.getTime() + AUTO_OFFER_OPEN_HOURS * 3_600_000).toISOString();
}

export type AutoOfferCandidate = {
  business_id: string; name: string;
  /** Verified coverage (Partners › Coverage) includes the job postcode. */
  coversPostcode: boolean;
  /** accepting_new_jobs === false. */
  paused: boolean;
  /** Required credentials current — includes public liability (H3) and, for RECs, licence/REC registration. */
  credentialsOk: boolean;
  /** Installers: at least one person with a Full, current CII/EEC clearance. RECs: an approved licensed electrician. */
  workersCleared: boolean;
  /** Any other existing eligibility blocker (approval, own-customers-only, no agreed rate, owner times …); null = none. */
  blocker: string | null;
  activeJobs: number;
  /** Straight-line km from the business base to the job postcode; null = unknown (sorted last). */
  distanceKm: number | null;
};
export type AutoOfferRow = { business_id: string | null; status: string; offered_at: string; auto: boolean };

export type AutoOfferStep =
  | { action: "none"; reason: "switch_off" | "job_not_ready" | "already_assigned" | "returned_to_office" | "offer_open" | "office_in_charge" }
  | { action: "offer"; businessId: string; name: string; attempt: number; basis: "usual_electrician" | "coverage"; activeJobs: number; distanceKm: number | null }
  | { action: "return_to_office"; reason: "two_misses" | "no_match"; misses: number; tried: string[] };

/** Why a candidate can't get the automatic offer (null = it can). */
export function autoOfferExclusion(c: AutoOfferCandidate, tried: Set<string>): string | null {
  if (tried.has(c.business_id)) return "Already offered this job (declined or lapsed).";
  if (c.paused) return "Paused — not accepting new jobs.";
  if (!c.credentialsOk) return "A required document (e.g. public liability) has expired.";
  if (!c.workersCleared) return "No cleared person (CII / licence) recorded.";
  if (!c.coversPostcode) return "Coverage does not include this postcode.";
  if (c.blocker) return c.blocker;
  return null;
}

const byDistance = (a: AutoOfferCandidate, b: AutoOfferCandidate) =>
  (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY);

/** Installers: eligible only, fewest active jobs, then nearest, then name. */
export function rankAutoInstallers(cands: AutoOfferCandidate[], tried: Set<string> = new Set()): AutoOfferCandidate[] {
  return cands.filter((c) => !autoOfferExclusion(c, tried))
    .sort((a, b) => a.activeJobs - b.activeJobs || byDistance(a, b) || a.name.localeCompare(b.name));
}

/** Electricians: the installer's usual electrician first (when eligible), then nearest, then fewest active jobs, then name. */
export function rankAutoElectricians(cands: AutoOfferCandidate[], tried: Set<string> = new Set(), usualBusinessId: string | null = null): AutoOfferCandidate[] {
  return cands.filter((c) => !autoOfferExclusion(c, tried))
    .sort((a, b) => Number(b.business_id === usualBusinessId) - Number(a.business_id === usualBusinessId) || byDistance(a, b) || a.activeJobs - b.activeJobs || a.name.localeCompare(b.name));
}

/** Automatic offers that came back (declined or lapsed) on this job. */
export function autoOfferMisses(rows: AutoOfferRow[]): number {
  return rows.filter((r) => r.auto && (r.status === "declined" || r.status === "expired")).length;
}

export type AutoOfferFacts = {
  kind: AutoOfferKind; switchOn: boolean;
  /** Right stage/channel, not deleted, not a TEST job, and (PIESA) the office-picks mode with no per-job override. */
  jobReady: boolean;
  hasTrade: boolean;
  /** An `auto_offer_returned_to_office` event already exists for this kind: the office has it now. */
  returned: boolean;
  rows: AutoOfferRow[];
};

/** Precheck without candidates (cheap): null = go on and rank candidates. */
export function autoOfferBlocked(f: AutoOfferFacts): Extract<AutoOfferStep, { action: "none" }> | Extract<AutoOfferStep, { action: "return_to_office" }> | null {
  if (!f.switchOn) return { action: "none", reason: "switch_off" };
  if (!f.jobReady) return { action: "none", reason: "job_not_ready" };
  if (f.hasTrade) return { action: "none", reason: "already_assigned" };
  if (f.returned) return { action: "none", reason: "returned_to_office" };
  if (f.rows.some((r) => r.status === "pending" || r.status === "accepted")) return { action: "none", reason: "offer_open" };
  // Any offer the office (or the batch "Automatic" dispatch mode) made itself: the office is in charge of this job.
  if (f.rows.some((r) => !r.auto)) return { action: "none", reason: "office_in_charge" };
  const misses = autoOfferMisses(f.rows);
  if (misses >= AUTO_OFFER_MAX_MISSES) return { action: "return_to_office", reason: "two_misses", misses, tried: tried(f.rows) };
  return null;
}

const tried = (rows: AutoOfferRow[]) => [...new Set(rows.map((r) => r.business_id).filter((x): x is string => !!x))];

/** The next step for one job: offer ONE trade, hand the job back to the office, or do nothing. */
export function autoOfferStep(f: AutoOfferFacts & { candidates: AutoOfferCandidate[]; usualBusinessId?: string | null }): AutoOfferStep {
  const blocked = autoOfferBlocked(f);
  if (blocked) return blocked;
  const done = new Set(tried(f.rows));
  const ranked = f.kind === "ready_check" ? rankAutoInstallers(f.candidates, done) : rankAutoElectricians(f.candidates, done, f.usualBusinessId ?? null);
  const misses = autoOfferMisses(f.rows);
  const pick = ranked[0];
  if (!pick) return { action: "return_to_office", reason: "no_match", misses, tried: [...done] };
  return {
    action: "offer", businessId: pick.business_id, name: pick.name, attempt: misses + 1,
    basis: f.kind === "piesa" && pick.business_id === (f.usualBusinessId ?? null) ? "usual_electrician" : "coverage",
    activeJobs: pick.activeJobs, distanceKm: pick.distanceKm,
  };
}

/** Office wording for the "Choose again" hand-back (Needs me reads `auto_offer_returned_to_office`). */
export function autoOfferReturnedSummary(kind: AutoOfferKind, reason: "two_misses" | "no_match", misses: number): string {
  const who = kind === "ready_check" ? "installer" : "electrician";
  return reason === "two_misses"
    ? `Automatic ${who} offers: ${misses} ${who}s didn't take it — choose again`
    : misses
      ? `Automatic ${who} offers: no other approved ${who} covers this postcode — choose again`
      : `Automatic ${who} offers: no approved ${who} covers this postcode — choose one`;
}
