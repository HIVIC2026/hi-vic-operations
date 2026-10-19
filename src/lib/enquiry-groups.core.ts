// Office enquiry / email groups (Jo, 3 Oct 2026). PURE: no I/O.
// Presentation-level grouping for bulk email PREPARATION only. It never decides eligibility, never changes a job stage,
// Gate 1 outcome, verified eligibility or delivery status. It only reads the recorded official Gate 1 audit.
import { GATE1_RULESET_VERSION, normaliseInsulation } from "./eligibility.core";
import { DEFAULT_ESTIMATED_AREA_M2 } from "./estimate.core";
import { emailSuppression, isTestRecipient, type EmailPurpose } from "./emailsafety.core";

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

/** Office photo/video review outcome (Jo, 8 Oct 2026): below R2 → offer Save my spot; over R2 → ineligible; unclear → ask for more pictures. */
export type MediaReviewOutcome = "below_r2" | "over_r2" | "unclear";
export const MEDIA_OUTCOME_LABEL: Record<MediaReviewOutcome, string> = {
  below_r2: "Below R2 – offer Save my spot",
  over_r2: "R2 or above – not eligible",
  unclear: "Not clear – ask for more pictures",
};

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
  /** Canonical owner answer (normaliseInsulation over Base44 answers), never inferred. */
  declaredInsulation?: "none" | "present" | "unknown" | null;
  /** Latest office review of the owner's uploaded photos/videos. Overrides the insulation-only grouping, never the recorded Gate 1 audit. */
  officeInsulation?: MediaReviewOutcome | null;
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

/** Every non-insulation preliminary gate that must be POSITIVELY represented, with the allowed results. */
// Current simple Gate 1 ruleset has no separate "relevant ceiling" rule; it is not required here.
export const REQUIRED_GATES: Record<string, string[]> = {
  location: ["pass"], residential: ["pass"], ceiling_age: ["pass"], previous_activity: ["pass"], roof_access: ["pass", "info"],
};
const INFO_ONLY = new Set(["life_support", "occupancy", "area", "preliminary", "rollout", "relevant_ceiling"]);

/** Insulation-details group: existing insulation (present OR unsure) is the ONLY open item; every other required gate passed. */
export function insulationOnly(audit: StoredAudit, declared: EnquiryInput["declaredInsulation"]): { ok: true } | { ok: false; why: string; missing: boolean } {
  const rules = Array.isArray(audit?.rules) ? audit!.rules! : [];
  if (!rules.length) return { ok: false, why: "Screening reasons were not recorded", missing: false };
  const canonical = normaliseInsulation(declared ?? null);
  if (canonical === "none") return { ok: false, why: "Owner declared no insulation – screening disagrees", missing: false };
  if (canonical === null) return { ok: false, why: "Owner did not answer the insulation question", missing: true };
  const ins = rules.find((r) => r.key === "existing_insulation");
  if (!ins || ins.result !== "onsite") return { ok: false, why: "Existing-insulation check not recorded as open", missing: false };
  for (const [k, allowed] of Object.entries(REQUIRED_GATES)) {
    const rs = rules.filter((x) => x.key === k);
    if (!rs.length) return { ok: false, why: `Check not recorded: ${k.replace(/_/g, " ")}`, missing: false };
    if (rs.some((r) => !allowed.includes(r.result ?? ""))) return { ok: false, why: k === "roof_access" ? "Roof / access also needs onsite confirmation" : `Check not passed: ${k.replace(/_/g, " ")}`, missing: false };
  }
  const extra = rules.find((r) => r.key !== "existing_insulation" && !(r.key && r.key in REQUIRED_GATES) && !(INFO_ONLY.has(r.key ?? "") && r.result === "info"));
  if (extra) return { ok: false, why: `Also open: ${extra.reason ?? extra.key}`, missing: false };
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
    // Office photo/video review decides the insulation-only path (Jo, 8 Oct): below R2 → Save my spot offer, over R2 → ineligible, unclear → more pictures.
    if (x.officeInsulation === "below_r2") {
      if (area.m2 != null) return { group: "likely_size", otherReason: null, reason: "Office confirmed below R2 from photos/video", area, videoState, nextAction: GROUP_ACTION.likely_size };
      return { group: "likely_no_size", otherReason: null, reason: "Office confirmed below R2 from photos/video", area: { m2: ASSUMED_REFERENCE_AREA_M2, source: "assumed" }, videoState, nextAction: GROUP_ACTION.likely_no_size };
    }
    if (x.officeInsulation === "over_r2") return other("not_eligible", "Office confirmed existing insulation is R2 or above", area, videoState);
    const chk = insulationOnly(x.audit, x.declaredInsulation);
    if (chk.ok) return { group: "insulation_check", otherReason: null, reason: x.officeInsulation === "unclear" ? "Photos unclear – more pictures needed" : videoState === "received" ? "Video received – priority review" : "Existing insulation declared; all other checks passed", area, videoState, nextAction: x.officeInsulation === "unclear" ? "Request more photos" : videoState === "received" ? "Review video" : GROUP_ACTION.insulation_check };
    return other(chk.missing ? "missing_info" : "needs_review", chk.why, area, videoState);
  }
  return other("needs_review", `Unrecognised result: ${x.outcome}`, area, videoState);
}

// ---------- Email preparation (staff-reviewed drafts; nothing is sent or stored) ----------
export type TemplateKey = "step3_estimate_likely" | "step3_estimate_assumed" | "insulation_video_request" | "preliminary_ineligible";
export type PrepTemplate = { key: TemplateKey; campaign: string; purpose: EmailPurpose | "insulation_video_request"; label: string; approval: "approved" | "draft" } | { key: null; blocked: string };
export function templateFor(group: EnquiryGroup, otherReason: OtherReason | null): PrepTemplate {
  if (group === "likely_size") return { key: "step3_estimate_likely", campaign: "step3_estimate", purpose: "step3_estimate", label: "Preliminary estimate email (approved likely email)", approval: "approved" };
  if (group === "likely_no_size") return { key: "step3_estimate_assumed", campaign: "step3_estimate", purpose: "step3_estimate", label: "Preliminary estimate email (approved likely email, typical-home assumption wording)", approval: "approved" };
  if (group === "insulation_check") return { key: "insulation_video_request", campaign: "insulation_video_request", purpose: "insulation_video_request", label: "Calculator + optional phone video invitation (NEW DRAFT – needs approval before any send)", approval: "draft" };
  if (otherReason === "not_eligible") return { key: "preliminary_ineligible", campaign: "preliminary_ineligible", purpose: "preliminary_ineligible", label: "Preliminary eligibility result email (approved)", approval: "approved" };
  if (!otherReason) return { key: null, blocked: "Choose a reason first – there is no catch-all email." };
  return { key: null, blocked: `No email for "${OTHER_LABEL[otherReason]}" – these need individual handling.` };
}

export type ContactFacts = {
  id: string; group: EnquiryGroup; otherReason: OtherReason | null; email: string | null;
  consent: string | null; optedOut: boolean; bounced: boolean; source: string | null;
  alreadySentCampaign: boolean; isPrimaryForContact: boolean;
};
/** CONTACT exclusions for a staff-prepared draft. Automatic-email scheduling rules are NOT applied here (see sendHolds). */
export function contactExclusion(c: ContactFacts, selected: { group: EnquiryGroup; otherReason: OtherReason | null }): string | null {
  if (c.group !== selected.group || (selected.group === "other" && c.otherReason !== selected.otherReason)) return `Group changed – now ${c.group === "other" && c.otherReason ? OTHER_LABEL[c.otherReason] : GROUP_LABEL[c.group]}`;
  if (!c.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email.trim())) return "Missing or invalid email";
  if (c.source === "qa_test" || isTestRecipient(c.email)) return "Test or example address";
  if (c.consent !== "granted") return c.consent === "withdrawn" || c.consent === "revoked" ? "Contact consent withdrawn" : "Contact consent unknown";
  if (c.optedOut) return "Unsubscribed";
  if (c.bounced) return "Bounced, complaint or later customer activity";
  if (!c.isPrimaryForContact) return "Duplicate – newer enquiry from the same contact for the same property";
  if (c.alreadySentCampaign) return "Already sent this email for this enquiry";
  return null;
}

export const SUPPRESSION_WORDS: Record<string, string> = {
  unsubscribed: "Unsubscribed", bounced: "Bounced / complaint / later activity", test_or_example_recipient: "Test or example address",
  job_progressed_or_closed: "Automatic-email stage rule (this stage is outside automatic estimate emails)", backlog_cutoff_not_set: "Delivery start date not set",
  backlog_before_cutoff: "Enquiry is before the delivery start date", backlog_too_old: "Enquiry older than 14 days (automatic-email rule)",
};
/** SEND holds shown alongside a draft: the unchanged live/automatic safeguards. They never hide the draft. */
export function sendHolds(x: { commsEnabled: boolean; approval: "approved" | "draft"; purpose: string; stage: string; source: string | null; createdAt: string; email: string | null; jobsCreatedAfter: string | null; now?: number }): string[] {
  const holds: string[] = [];
  if (!x.commsEnabled) holds.push("Customer communications are OFF");
  if (x.approval === "draft") holds.push("New template – needs approval before sending");
  if (x.purpose === "step3_estimate" || x.purpose === "preliminary_ineligible") {
    const s = emailSuppression({ purpose: x.purpose, optedOut: false, bounced: false, stage: x.stage, jobSource: x.source, jobCreatedAt: x.createdAt, recipient: x.email, jobsCreatedAfter: x.jobsCreatedAfter, now: x.now ?? Date.now() });
    if (s) holds.push(SUPPRESSION_WORDS[s] ?? s);
  } else holds.push("No manual send path yet – sending stays locked");
  return holds;
}

/** Conservative same-property key: postcode + address line, lower-cased, punctuation/space collapsed. */
export function propertyKey(address: string | null | undefined, postcode: string | null | undefined): string {
  const a = (address ?? "").toLowerCase().replace(/\b(vic|victoria)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return `${(postcode ?? "").trim()}|${a}`;
}
export const contactKey = (email: string | null | undefined, propKey: string) => { const e = email?.trim().toLowerCase(); return e ? `${e}#${propKey}` : null; };

/** Newest enquiry per same contact + same property is primary; different properties are always kept. */
export function primaryByContact(rows: { id: string; email: string | null; propKey: string; createdAt: string }[]): Set<string> {
  const best = new Map<string, { id: string; createdAt: string }>();
  for (const r of rows) {
    const k = contactKey(r.email, r.propKey);
    if (!k) continue;
    const cur = best.get(k);
    if (!cur || r.createdAt > cur.createdAt || (r.createdAt === cur.createdAt && r.id > cur.id)) best.set(k, r);
  }
  return new Set([...best.values()].map((v) => v.id));
}

// ---------- One office status per enquiry (Jo, 8 Oct 2026) ----------
// Presentation only: reads what actually happened (emails sent, spot saved, recorded eligibility). Never changes a job.
export type EnquiryStatus = "spot_saved" | "offered_spot" | "insulation_requested" | "ineligible" | "needs_attention";
export const STATUS_ORDER: EnquiryStatus[] = ["spot_saved", "offered_spot", "insulation_requested", "ineligible", "needs_attention"];
// One office outcome vocabulary, shared by Leads and the Office pipeline (GAP-03, P1-R2-S05).
// These are DISPLAY LABELS only. They intentionally mirror the enquiry-stage wording in
// office-status.core.ts (OFFICE_STATUSES "enquiry.*") so the same enquiry reads the same on both
// screens. Persisted status values, EnquiryStatus keys, enquiryStatus() logic and every workflow
// transition are unchanged. Unknown keys fall back safely via statusLabel() below.
export const STATUS_LABEL: Record<EnquiryStatus, string> = {
  spot_saved: "Spot saved, needs an installer",
  offered_spot: "Estimate sent, waiting for owner",
  insulation_requested: "Video asked for",
  ineligible: "Ineligible",
  needs_attention: "Needs attention",
};
/** Safe display-label lookup: known EnquiryStatus → shared label; anything else → "Needs attention". */
export function statusLabel(status: string | null | undefined): string {
  return (status && (STATUS_LABEL as Record<string, string>)[status]) || STATUS_LABEL.needs_attention;
}
/** Exactly one office outcome. Unsent results are exceptions, never a normal waiting queue. */
export function enquiryStatus(x: {
  spotSaved: boolean; ineligible: boolean; ineligibleEmailSent: boolean; campaignSent: boolean; insulationEmailSent: boolean;
  /** Which version the campaign email was for this owner: "likely" = Save my spot offer, "onsite" = insulation details request. */
  campaignGroup: "likely" | "onsite" | null;
}): EnquiryStatus {
  if (x.spotSaved) return "spot_saved";
  if (x.ineligible && x.ineligibleEmailSent) return "ineligible";
  if (x.insulationEmailSent || (x.campaignSent && x.campaignGroup === "onsite")) return "insulation_requested";
  if (x.campaignSent) return "offered_spot";
  return "needs_attention";
}

export type AutomaticLeadEmail = "offer_spot" | "request_insulation" | "ineligible" | "none";

/** Selects the single automatic email path. Gate 1 remains the source of the eligibility result. */
export function automaticLeadEmail(x: {
  source: string | null; channel: string | null; decisionSource: string | null; reviewRequired: boolean;
  outcome: string | null; intakeWorkActive: boolean; declaredInsulation: "none" | "present" | "unknown" | null;
  ownerEnteredArea: boolean;
}): { email: AutomaticLeadEmail; blocker: string | null; assumedArea?: true } {
  if (x.source === "qa_test") return { email: "none", blocker: "TEST enquiry" };
  if (x.source !== "base44" || x.channel !== "hivic_sourced") return { email: "none", blocker: "Not a website homeowner enquiry" };
  if (x.intakeWorkActive) return { email: "none", blocker: "Initial checks are still running" };
  if (x.decisionSource !== "system" && x.decisionSource !== "admin") return { email: "none", blocker: "Official eligibility result is missing" };
  if (x.reviewRequired) return { email: "none", blocker: "Eligibility needs office review" };
  if (x.outcome === "does_not_appear_eligible") return { email: "ineligible", blocker: null };
  if (x.outcome === "likely_eligible" && x.declaredInsulation === "none") {
    // No owner size: same initial response, priced on the clearly labelled typical 150 m² assumption (owner answer stays unknown).
    return { email: "offer_spot", blocker: null, ...(x.ownerEnteredArea ? {} : { assumedArea: true }) };
  }
  if ((x.outcome === "likely_eligible" || x.outcome === "needs_onsite_confirmation") && (x.declaredInsulation === "present" || x.declaredInsulation === "unknown")) return { email: "request_insulation", blocker: null };
  return { email: "none", blocker: "Eligibility or insulation details need office review" };
}
