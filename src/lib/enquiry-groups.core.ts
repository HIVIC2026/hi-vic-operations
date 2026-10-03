// Office enquiry / email groups (Jo, 3 Oct 2026). PURE: no I/O.
// Presentation-level grouping for bulk email PREPARATION only. It never decides eligibility, never changes a job stage,
// Gate 1 outcome, verified eligibility or delivery status. It only reads the recorded official Gate 1 audit.
import { GATE1_RULESET_VERSION } from "./eligibility.core";
import { DEFAULT_ESTIMATED_AREA_M2 } from "./estimate.core";
import { emailSuppression, type EmailPurpose } from "./emailsafety.core";

export type EnquiryGroup = "likely_size" | "likely_no_size" | "insulation_check" | "other";
export type OtherReason = "needs_review" | "missing_info" | "not_eligible" | "progressing" | "closed";
export type AreaSource = "measured" | "estimated" | "declared" | "assumed" | "none";

export const GROUP_ORDER: EnquiryGroup[] = ["likely_size", "likely_no_size", "insulation_check", "other"];
export const GROUP_LABEL: Record<EnquiryGroup, string> = {
  likely_size: "Likely eligible – size provided",
  likely_no_size: "Likely eligible – size needed",
  insulation_check: "Existing insulation – check needed",
  other: "Other enquiries",
};
export const GROUP_ACTION: Record<EnquiryGroup, string> = {
  likely_size: "Prepare estimate",
  likely_no_size: "Prepare average-size estimate",
  insulation_check: "Prepare calculator + video request",
  other: "Choose a reason first",
};
export const OTHER_ORDER: OtherReason[] = ["needs_review", "missing_info", "not_eligible", "progressing", "closed"];
export const OTHER_LABEL: Record<OtherReason, string> = {
  needs_review: "Needs office review", missing_info: "Missing information", not_eligible: "Not eligible", progressing: "Already progressing", closed: "Closed",
};
export const AREA_LABEL: Record<AreaSource, string> = { measured: "Measured", estimated: "Estimated (property records)", declared: "Declared by owner", assumed: "Assumed area", none: "—" };

/** The existing configured estimator reference area (estimate.core). Shown only as an "Assumed area", never stored as measured or declared. */
export const ASSUMED_REFERENCE_AREA_M2 = DEFAULT_ESTIMATED_AREA_M2;

/** Stages where a first preliminary email is still the right next step. Anything else is already progressing. */
export const ENQUIRY_STAGES = new Set(["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule"]);
const CLOSED_STAGES = new Set(["cancelled", "complete"]);
const REQUIRED_PASSES = ["location", "residential", "ceiling_age", "previous_activity"];

export type StoredRule = { key?: string; result?: string; fact?: string; basis?: string; reason?: string };
export type StoredAudit = { ruleset_version?: string; rules?: StoredRule[]; hard_failures?: string[]; review_reasons?: string[]; onsite_drivers?: string[] } | null;

export type EnquiryInput = {
  kind: "job" | "calculator";
  stage: string | null;
  holdReason?: string | null;
  outcome: string | null;
  decisionSource: string | null; // system | admin | preliminary | null
  reviewRequired: boolean;
  audit: StoredAudit;
  intakeWorkActive: boolean;
  area: { measured?: number | null; estimated?: number | null; declared?: number | null; declaredUnknown?: boolean | null };
  videoCount: number;
  calculatorStatus?: string | null;
};
export type EnquiryClass = {
  group: EnquiryGroup;
  otherReason: OtherReason | null;
  reason: string;
  area: { m2: number | null; source: AreaSource };
  videoState: "received" | "none";
  nextAction: string;
};

const usable = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

/** Strongest usable REAL area (measured > estimated > declared). Missing/zero/NaN/negative = none. */
export function realArea(a: EnquiryInput["area"]): { m2: number | null; source: AreaSource } {
  if (usable(a.measured)) return { m2: a.measured, source: "measured" };
  if (usable(a.estimated)) return { m2: a.estimated, source: "estimated" };
  if (!a.declaredUnknown && usable(a.declared)) return { m2: a.declared, source: "declared" };
  return { m2: null, source: "none" };
}

/** Group 3 test: positively declared insulation is the ONLY open item; every other preliminary check passed. */
export function insulationOnly(audit: StoredAudit): { ok: true } | { ok: false; why: string; missing: boolean } {
  const rules = Array.isArray(audit?.rules) ? audit!.rules! : [];
  if (!rules.length) return { ok: false, why: "Screening reasons were not recorded", missing: false };
  const ins = rules.find((r) => r.key === "existing_insulation");
  if (!ins || ins.result !== "onsite") return { ok: false, why: "Existing-insulation check not recorded as open", missing: false };
  if (!/present/i.test(ins.fact ?? "")) return { ok: false, why: "Existing insulation answer unknown – ask the owner", missing: true };
  for (const k of REQUIRED_PASSES) if (rules.find((r) => r.key === k)?.result !== "pass") return { ok: false, why: `Check not passed: ${k.replace(/_/g, " ")}`, missing: false };
  const other = rules.find((r) => r.key !== "existing_insulation" && r.result !== "pass" && r.result !== "info");
  if (other) return { ok: false, why: other.result === "onsite" && other.key === "roof_access" ? "Roof / access also needs onsite confirmation" : `Also open: ${other.reason ?? other.key}`, missing: false };
  return { ok: true };
}

const other = (otherReason: OtherReason, reason: string, area: EnquiryClass["area"], videoState: EnquiryClass["videoState"]): EnquiryClass =>
  ({ group: "other", otherReason, reason, area, videoState, nextAction: otherReason === "not_eligible" ? "Prepare not-eligible response" : otherReason === "progressing" ? "Continue in job record" : otherReason === "closed" ? "No action" : otherReason === "missing_info" ? "Get missing details" : "Office review" });

/** Exactly one group per enquiry. Precedence: closed > known fail > progressing > hold > missing/review > likely/insulation. */
export function classifyEnquiry(x: EnquiryInput): EnquiryClass {
  const area = realArea(x.area);
  const videoState = x.videoCount > 0 ? "received" : "none";
  if (x.kind === "calculator") {
    if (x.calculatorStatus === "closed") return other("closed", "Calculator registration closed", area, videoState);
    if (x.calculatorStatus === "booked") return other("progressing", "Calculator registration marked booked", area, videoState);
    return other("needs_review", "Calculator registration – not yet screened", area, videoState);
  }
  const stage = x.stage ?? "";
  const failed = (x.audit?.hard_failures?.length ?? 0) > 0 || (x.audit?.rules ?? []).some((r) => r.result === "fail");
  const official = x.decisionSource === "system" || x.decisionSource === "admin";
  if (CLOSED_STAGES.has(stage)) return other("closed", stage === "complete" ? "Job complete" : "Cancelled", area, videoState);
  if (official && x.outcome === "does_not_appear_eligible") return other("not_eligible", x.audit?.hard_failures?.[0] ?? "Recorded as not eligible", area, videoState);
  if (failed && x.decisionSource !== "admin") return other("not_eligible", x.audit?.hard_failures?.[0] ?? "A preliminary check failed", area, videoState);
  if (stage === "on_hold") return other("needs_review", `On hold${x.holdReason ? `: ${x.holdReason}` : ""}`, area, videoState);
  if (!ENQUIRY_STAGES.has(stage)) return other("progressing", `Stage: ${stage.replace(/_/g, " ")}`, area, videoState);
  if (x.intakeWorkActive) return other("missing_info", "Initial checks still running", area, videoState);
  if (!official) return other("missing_info", "No official preliminary result recorded", area, videoState);
  if (x.reviewRequired || !x.outcome) return other("needs_review", x.audit?.review_reasons?.[0] ?? "Review required", area, videoState);
  if (x.decisionSource === "system" && x.audit?.ruleset_version !== GATE1_RULESET_VERSION) return other("needs_review", "Screening out of date – re-check against current rules", area, videoState);
  if (x.outcome === "likely_eligible") {
    if (area.m2 != null) return { group: "likely_size", otherReason: null, reason: `${AREA_LABEL[area.source]} ceiling area`, area, videoState, nextAction: GROUP_ACTION.likely_size };
    return { group: "likely_no_size", otherReason: null, reason: "No usable ceiling area", area: { m2: ASSUMED_REFERENCE_AREA_M2, source: "assumed" }, videoState, nextAction: GROUP_ACTION.likely_no_size };
  }
  if (x.outcome === "needs_onsite_confirmation") {
    const chk = insulationOnly(x.audit);
    if (chk.ok) return { group: "insulation_check", otherReason: null, reason: videoState === "received" ? "Video received – priority review" : "Existing insulation declared; all other checks passed", area, videoState, nextAction: videoState === "received" ? "Review video" : GROUP_ACTION.insulation_check };
    return other(chk.missing ? "missing_info" : "needs_review", chk.why, area, videoState);
  }
  return other("needs_review", `Unrecognised result: ${x.outcome}`, area, videoState);
}

// ---------- Email preparation (review only; nothing is sent or stored) ----------
export type PrepTemplate = { key: string; purpose: EmailPurpose; label: string; subject: string } | { key: null; blocked: string };
export function templateFor(group: EnquiryGroup, otherReason: OtherReason | null): PrepTemplate {
  if (group === "likely_size") return { key: "step3_estimate_likely", purpose: "step3_estimate", label: "Preliminary estimate email (approved, locked)", subject: "Personalised: estimate amount in subject (approved likely email)" };
  if (group === "likely_no_size") return { key: "step3_estimate_likely", purpose: "step3_estimate", label: "Preliminary estimate email (approved, locked) – typical-area wording", subject: "Personalised: estimate amount in subject (approved likely email)" };
  if (group === "insulation_check") return { key: null, blocked: "No approved calculator + video request template yet, and there is no secure no-login video upload for owners. Nothing can be prepared." };
  if (otherReason === "not_eligible") return { key: "preliminary_ineligible", purpose: "preliminary_ineligible", label: "Preliminary eligibility result email (approved)", subject: "Your ceiling insulation eligibility result" };
  if (!otherReason) return { key: null, blocked: "Choose a reason first – there is no catch-all email." };
  return { key: null, blocked: `No approved email for "${OTHER_LABEL[otherReason]}". Handle these one by one.` };
}

export type ContactFacts = {
  id: string; group: EnquiryGroup; otherReason: OtherReason | null; email: string | null;
  consent: string | null; optedOut: boolean; bounced: boolean; stage: string; source: string | null; createdAt: string;
  alreadySent: boolean; jobsCreatedAfter: string | null; isPrimaryForEmail: boolean;
};
export const SUPPRESSION_WORDS: Record<string, string> = {
  unsubscribed: "Unsubscribed", bounced: "Bounced / complaint / later activity", test_or_example_recipient: "Test or example address",
  job_progressed_or_closed: "Stage no longer allows this email", backlog_cutoff_not_set: "Delivery start date not set (communications off)",
  backlog_before_cutoff: "Enquiry before delivery start date", backlog_too_old: "Enquiry older than 14 days (existing safety rule)",
};
/** First reason wins; null = would be included. Revalidates the CURRENT group against the selected one. */
export function exclusionFor(c: ContactFacts, selected: { group: EnquiryGroup; otherReason: OtherReason | null }, purpose: EmailPurpose, now = Date.now()): string | null {
  if (c.group !== selected.group || (selected.group === "other" && c.otherReason !== selected.otherReason)) return `Group changed – now ${c.group === "other" && c.otherReason ? OTHER_LABEL[c.otherReason] : GROUP_LABEL[c.group]}`;
  if (!c.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return "Missing or invalid email";
  if (c.consent !== "granted") return c.consent === "withdrawn" ? "Contact consent withdrawn" : "Contact consent unknown";
  if (!c.isPrimaryForEmail) return "Duplicate contact – newer enquiry for the same email";
  if (c.alreadySent) return "Already sent this email";
  const s = emailSuppression({ purpose, optedOut: c.optedOut, bounced: c.bounced, stage: c.stage, jobSource: c.source, jobCreatedAt: c.createdAt, recipient: c.email, jobsCreatedAfter: c.jobsCreatedAfter, now });
  return s ? SUPPRESSION_WORDS[s] ?? s : null;
}

/** Newest enquiry per normalised email is the primary contact; older repeats are duplicates. */
export function primaryByEmail(rows: { id: string; email: string | null; createdAt: string }[]): Set<string> {
  const best = new Map<string, { id: string; createdAt: string }>();
  for (const r of rows) {
    const k = r.email?.trim().toLowerCase();
    if (!k) continue;
    const cur = best.get(k);
    if (!cur || r.createdAt > cur.createdAt || (r.createdAt === cur.createdAt && r.id > cur.id)) best.set(k, r);
  }
  return new Set([...best.values()].map((v) => v.id));
}
