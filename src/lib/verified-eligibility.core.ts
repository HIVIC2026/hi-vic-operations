// Verified property eligibility after the Ready Check — pure rules only (no I/O).
// Office records ONE current result per job. Recording a result never changes the job stage,
// creates a quote, requests a PIESA, touches payments, schedules visits or sends messages.

export const VERIFIED_OUTCOMES = ["pending", "eligible", "not_eligible", "needs_review"] as const;
export type VerifiedOutcome = (typeof VERIFIED_OUTCOMES)[number];

export const VERIFIED_LABEL: Record<VerifiedOutcome, string> = {
  pending: "Pending",
  eligible: "Verified eligible",
  not_eligible: "Not eligible",
  needs_review: "Needs office review",
};

/** Activity 48 existing-insulation rule: average uncompressed R-value must be LESS THAN this. R2.0 exactly does not pass. */
export const R_VALUE_LIMIT = 2.0;
export const VERIFIED_RULESET = "verified-eligibility-v1";

export type ReadyCheckEvidence = {
  readyCheck: { ref: string | null; version: number | null; final: boolean; submissionRef: string | null };
  /** Version of the newest Ready Check on the job (null = none). */
  currentVersion: number | null;
  attendance: { installer: boolean; attendedAt: boolean; geotagPhoto: boolean; ceilingMedia: boolean };
  measure: { areaM2: number | null; method: string | null };
  insulation: { existing: "none" | "present" | "unknown" | null; type: string | null; depthMm: number | null; rValue: number | null; photos: boolean };
  removal: "yes" | "no" | "uncertain" | null;
  access: { level: string | null; evidence: boolean };
  /** Owner's declared previous VEU ceiling-insulation upgrade. */
  previousUpgrade: "yes" | "no" | null;
  /** Section D — shown and flagged, never property-eligibility evidence on its own. */
  electrical: { downlightCount: number | null; downlightType: string | null };
  /** Conflicting / amended evidence noted by sync or office. */
  conflicts: string[];
};

export type EligibilityAssessment = {
  missing: string[];
  reviewReasons: string[];
  flags: string[];
  evidenceComplete: boolean;
  eligibleAllowed: boolean;
  suggested: Exclude<VerifiedOutcome, "pending">;
};

const has = (v: unknown) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");

/** Strictly less than the limit. Exactly R2.0 is NOT less than R2.0. */
export function rBelowLimit(r: number): boolean {
  return Number.isFinite(r) && r < R_VALUE_LIMIT;
}

export function assessEligibility(e: ReadyCheckEvidence): EligibilityAssessment {
  const missing: string[] = [];
  const review: string[] = [];
  const flags: string[] = [];
  const rc = e.readyCheck;

  if (!has(rc.ref) || rc.version === null) missing.push("Ready Check record and version");
  if (!rc.final || !has(rc.submissionRef)) missing.push("Final Ready Check submission reference");
  if (rc.version !== null && e.currentVersion !== null && rc.version !== e.currentVersion) review.push("A newer Ready Check version exists — evidence is out of date.");

  if (!e.attendance.installer) missing.push("Installer attendance");
  if (!e.attendance.attendedAt) missing.push("Time attended");
  if (!e.attendance.geotagPhoto) missing.push("Geotagged attendance photo");
  if (!e.attendance.ceilingMedia) missing.push("Ceiling-space photos/video");
  if (!(typeof e.measure.areaM2 === "number" && e.measure.areaM2 > 0)) missing.push("Measured ceiling area");
  if (!has(e.measure.method)) missing.push("Measurement method");
  if (!has(e.access.level)) missing.push("Access/site assessment");
  else if (e.access.level === "difficult" && !e.access.evidence) review.push("Difficult access recorded without access evidence — confirm the area could be measured reliably.");

  const ins = e.insulation;
  if (ins.existing === null) missing.push("Existing insulation status");
  else if (ins.existing === "unknown") review.push("Existing insulation status is unknown.");
  else if (ins.existing === "present") {
    if (!has(ins.type)) missing.push("Existing insulation type");
    if (!ins.photos) missing.push("Existing insulation photos");
    if (ins.rValue === null && ins.depthMm === null) missing.push("Existing insulation depth or R-value");
    if (ins.rValue === null) review.push("Existing insulation present without a reliable average R-value — assess type, condition, area and R-value.");
    else if (!rBelowLimit(ins.rValue)) review.push(`Existing insulation average R${ins.rValue} is not less than R${R_VALUE_LIMIT.toFixed(1)}.`);
  }

  if (e.removal === null) missing.push("Removal answer");
  else if (e.removal === "uncertain") review.push("Removal requirement is uncertain.");

  if (e.previousUpgrade === "yes") review.push("Owner declared a previous VEU ceiling-insulation upgrade — office review required.");
  for (const c of e.conflicts) review.push(`Conflicting or amended evidence: ${c}`);

  if (e.electrical.downlightCount === null || !has(e.electrical.downlightType) || e.electrical.downlightType === "unable_to_confirm")
    flags.push("Safety/planning: downlight observations missing or unclear — confirm at PIESA planning.");

  const evidenceComplete = missing.length === 0;
  const eligibleAllowed = evidenceComplete && review.length === 0;
  return { missing, reviewReasons: review, flags, evidenceComplete, eligibleAllowed, suggested: eligibleAllowed ? "eligible" : "needs_review" };
}

/** Errors for an office recording attempt (empty = allowed). Mirrored in the database function. */
export function recordErrors(outcome: VerifiedOutcome, a: EligibilityAssessment, reason: string | null, note: string | null): string[] {
  const out: string[] = [];
  if (outcome === "eligible" && !a.evidenceComplete) out.push(`Eligible needs all mandatory Ready Check evidence. Missing: ${a.missing.join(", ")}.`);
  if (outcome === "eligible" && a.reviewReasons.length) out.push(`Eligible cannot be recorded while review items are open: ${a.reviewReasons.join(" ")}`);
  if (outcome === "not_eligible" && !has(reason)) out.push("Not eligible needs an office reason.");
  if ((outcome === "needs_review" || outcome === "pending") && !has(note) && !has(reason)) out.push("Add a note explaining what needs review.");
  return out;
}

export type StoredVerification = { outcome: VerifiedOutcome; ready_check_ref: string; ready_check_version: number };

/** Out of date when a different or newer Ready Check now exists. */
export function verificationStale(v: StoredVerification | null, current: { ref: string | null; version: number | null }): boolean {
  if (!v) return false;
  return v.ready_check_ref !== current.ref || v.ready_check_version !== current.version;
}

/** True only for a current, not-stale "eligible" result. */
export function verifiedEligibleNow(v: StoredVerification | null, current: { ref: string | null; version: number | null }): boolean {
  return !!v && v.outcome === "eligible" && !verificationStale(v, current);
}
