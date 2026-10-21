import { declaredExtras } from "./enquiry.core";
// THE single, pure, deterministic Gate 1 categoriser (Activity 48 – VEET Amendment (Ceiling Insulation) Regulations 2026,
// reg 10(9)-(10) / Part 48). Property Intelligence and Base44 only supply FACTS; this file alone decides.
// Hierarchy (locked): A hard failure -> does_not_appear_eligible; B contradiction/insufficient remote evidence -> internal
// REVIEW REQUIRED (no customer outcome); C remote rules satisfied but technical onsite fact open -> needs_onsite_confirmation;
// D all remote rules satisfied -> likely_eligible (still subject to onsite insulation, lighting and electrical checks).
// Owner declarations are never "verified" and never hard-fail on their own. Base44 preliminary screening is information only.

export const GATE1_RULESET_VERSION = "gate1-a48-2026.3-simple";
/** General rollout of Activity 48 starts on this date (14 Apr–30 Sep 2026 limited to public/community housing). */
export const GENERAL_ROLLOUT_START = "2026-10-01";

export type FactBasis = "verified" | "recorded" | "declared" | "unknown";
export type FactEvidence = { fact: string; source: string; basis: FactBasis };
export type RuleKey = "location" | "address" | "residential" | "relevant_ceiling" | "ceiling_age" | "previous_activity" | "existing_insulation"
  | "roof_access" | "life_support" | "occupancy" | "area" | "rollout" | "preliminary";
export type RuleResult = "pass" | "fail" | "review" | "onsite" | "info";
export type RuleEvidence = FactEvidence & { key: RuleKey; label: string; result: RuleResult; reason: string };
export type Gate1Flag = { key: string; type: "safety" | "operational" | "data"; severity: "high" | "medium" | "low"; reason: string };
export type CustomerOutcome = "likely_eligible" | "needs_onsite_confirmation" | "does_not_appear_eligible";

/** Rules where an explicit owner declaration is accepted on its own for a pass. */
export const DECLARATION_ALLOWED: Partial<Record<RuleKey, boolean>> = { previous_activity: true, existing_insulation: true };

/** Technical facts that are ALWAYS confirmed onsite (never make a job "needs onsite" on their own). */
export const ONSITE_ALWAYS = [
  "Existing insulation type / R-value (none, or foil / uncompressed averaging < R2.0)",
  "All relevant-ceiling luminaires IC / IC-4",
  "Pre Insulation Electrical Safety Assessment (PIESA) / PIESA",
  "Measured relevant ceiling area",
];

export type Gate1Facts = {
  state: string | null;
  postcode: string | null;
  occupancy: string | null;
  isResidential: boolean | null;
  yearBuilt: number | null;
  yearBuiltVerified: boolean; // verified construction year of the relevant structure (hard-fail capable)
  minBuildingAgeYears: number;
  lifeSupportStatus: string | null; // yes | no | unknown | null -> safety flag only
  previousCeilingUpgrade: boolean | null; // generic "previous upgrade" – never proves a previous Activity 48
  flatRoofOrAccessConcern: boolean; // operational flag only
  preliminaryOutcome: string | null; // Base44 info only – never decides
  currentYear: number;
  verifiedMinAgeYears?: number | null;
  declaredOverMinAge?: "yes" | "no" | "unknown" | null;
  residentialNote?: string | null; // declaration-only / conflicting residential evidence -> review
  addressAmbiguous?: boolean;
  declaredPropertyType?: string | null;
  declaredTopFloor?: "yes" | "no" | "unknown" | null;
  noRelevantCeilingDirect?: boolean; // direct evidence: no ceiling with roof cavity/exposed roof and no storey above
  storeyAboveIndicated?: boolean; // evidence of another storey above part of the ceiling (scope uncertain -> review)
  recentExtensionRisk?: "yes" | "no" | "unknown" | null;
  declaredHouse?: boolean; // owner declared house/townhouse, no research classification (preliminary only)
  addressVerifiedVic?: boolean; // trusted address evidence: real Victorian premises
  previousActivity48Confirmed?: boolean | null; // only trusted/direct portal or registry fact
  declaredInsulation?: "none" | "present" | "unknown" | null; // Base44 answers.insulation
  verifiedInsulation?: "qualifying" | "disqualifying" | null; // verified onsite finding
  areaKnown?: boolean | null;
  publicHousingVerified?: boolean;
  referenceDate?: string | null; // YYYY-MM-DD (Melbourne); drives the 2026 rollout hold
  evidence?: Partial<Record<RuleKey, FactEvidence>>;
};

export type Gate1Decision = {
  ruleset_version: string;
  /** Customer-facing category; null while REVIEW REQUIRED. */
  outcome: CustomerOutcome | null;
  internalStatus: "auto_decided" | "review_required";
  reviewRequired: boolean;
  passed: string[];
  failed: string[];
  review: string[];
  onsite: string[]; // technical onsite facts that drive needs_onsite_confirmation
  onsiteRequirements: string[]; // everything to confirm onsite
  flags: Gate1Flag[];
  rolloutHold: boolean;
  rules: RuleEvidence[];
  nextAction: string;
  referenceDate: string | null;
};

const VIC_POSTCODE = /^(3\d{3}|8\d{3})$/;
const APARTMENT = /\b(apartment|unit|flat)\b/i;

export function rolloutHoldActive(referenceDate: string | null | undefined, publicHousingVerified = false): boolean {
  return !!referenceDate && referenceDate < GENERAL_ROLLOUT_START && !publicHousingVerified;
}

export function evaluateGate1(f: Gate1Facts): Gate1Decision {
  const passed: string[] = [], failed: string[] = [], review: string[] = [], onsite: string[] = [], rules: RuleEvidence[] = [], flags: Gate1Flag[] = [];
  const ev = (k: RuleKey, fallback: FactEvidence): FactEvidence => f.evidence?.[k] ?? fallback;
  const rule = (key: RuleKey, label: string, result: RuleResult, reason: string, e: FactEvidence) => {
    rules.push({ key, label, result, reason, ...e });
    ({ pass: passed, fail: failed, review, onsite, info: null as string[] | null })[result]?.push(reason);
  };
  const st = f.state?.trim().toUpperCase() ?? null;
  const pc = f.postcode?.trim() ?? null;

  // SIMPLE Gate 1 (Jo, 4 Oct 2026): homeowner answers only. Remote property research no longer decides or raises review.
  const loc = ev("location", { fact: [st, pc].filter(Boolean).join(" ") || "—", source: "properties", basis: st || pc ? "recorded" : "unknown" });
  if (st && st !== "VIC") rule("location", "Victorian property", "fail", `Property state is ${st} (Victoria only)`, loc);
  else if (pc && !VIC_POSTCODE.test(pc)) rule("location", "Victorian property", "fail", `Postcode ${pc} is not a Victorian postcode`, loc);
  else if (st || pc) rule("location", "Victorian property", "pass", "Victorian property", loc);
  else rule("location", "Victorian property", "onsite", "Confirm the property is in Victoria", loc);

  // Property type (declared)
  const isApartment = !!f.declaredPropertyType && APARTMENT.test(f.declaredPropertyType);
  const res = ev("residential", { fact: f.declaredPropertyType ? `owner: ${f.declaredPropertyType}` : f.isResidential == null ? "unknown" : String(f.isResidential), source: f.declaredPropertyType ? "base44 owner declaration" : "properties.is_residential", basis: f.declaredPropertyType ? "declared" : f.isResidential == null ? "unknown" : "recorded" });
  if (f.isResidential === false || classifyPremises(f.declaredPropertyType) === "non_residential") rule("residential", "Home (house, townhouse or unit)", "fail", "Property is not a home", res);
  else if (isApartment && f.declaredTopFloor !== "yes") rule("residential", "Home (house, townhouse or unit)", "onsite", f.declaredTopFloor === "no" ? "Owner says the unit is not top floor – confirm there is a ceiling under the roof" : "Unit – confirm it is top floor with a ceiling under the roof", res);
  else rule("residential", "Home (house, townhouse or unit)", "pass", f.declaredPropertyType ? `Owner says ${f.declaredPropertyType}` : "Home", res);

  // Building age (declared, or a verified record entered by the office)
  const min = f.minBuildingAgeYears;
  const L = "Building over 5 years old";
  const age = ev("ceiling_age", { fact: f.declaredOverMinAge ? `owner: over 5 years = ${f.declaredOverMinAge}` : f.yearBuilt ? `built ${f.yearBuilt}` : "unknown", source: f.declaredOverMinAge ? "base44 owner declaration" : "properties.year_built", basis: f.declaredOverMinAge ? "declared" : f.yearBuiltVerified ? "verified" : "unknown" });
  const verifiedAge = f.yearBuilt != null && f.yearBuiltVerified ? f.currentYear - f.yearBuilt : null;
  if (verifiedAge != null && verifiedAge < min) rule("ceiling_age", L, "fail", `Building is ${verifiedAge} years old (under ${min} years)`, age);
  else if (verifiedAge != null) rule("ceiling_age", L, "pass", `Building is ${verifiedAge} years old`, age);
  else if (f.declaredOverMinAge === "no") rule("ceiling_age", L, "fail", `Owner says the building is under ${min} years old`, age);
  else if (f.declaredOverMinAge === "yes") rule("ceiling_age", L, "pass", `Owner says the building is over ${min} years old`, age);
  else rule("ceiling_age", L, "onsite", `Confirm the building is over ${min} years old`, age);

  // Previous Activity 48 — only confirmed office evidence can fail.
  const PL = "Previous Activity 48";
  if (f.previousActivity48Confirmed === true) rule("previous_activity", PL, "fail", "Previous Activity 48 for the same ceiling area confirmed", { fact: "previous Activity 48 confirmed", source: "properties.enrichment.previous_activity_48_confirmed", basis: "verified" });
  else rule("previous_activity", PL, "pass", "No confirmed previous Activity 48 for the same ceiling area", ev("previous_activity", { fact: "none confirmed", source: "properties.enrichment", basis: "recorded" }));

  // Existing insulation above the relevant ceiling
  const IL = "Existing insulation";
  if (f.verifiedInsulation === "disqualifying") rule("existing_insulation", IL, "fail", "Verified onsite: existing insulation fails the criterion (average R ≥ 2.0 or not foil/uncompressed)", { fact: "disqualifying", source: "verified onsite finding", basis: "verified" });
  else if (f.verifiedInsulation === "qualifying") rule("existing_insulation", IL, "pass", "Verified onsite: none, or foil/uncompressed averaging < R2.0", { fact: "qualifying", source: "verified onsite finding", basis: "verified" });
  else {
    const di = f.declaredInsulation ?? null;
    const ie = ev("existing_insulation", { fact: di ? `owner: ${di}` : "unknown", source: di ? "base44 answers.insulation" : "—", basis: di ? "declared" : "unknown" });
    if (di === "none") rule("existing_insulation", IL, "pass", "Owner declares no existing insulation (confirmed onsite)", ie);
    else if (di === "present") rule("existing_insulation", IL, "onsite", "Owner says insulation is present – type and R-value must be confirmed onsite", ie);
    else rule("existing_insulation", IL, "onsite", "Existing insulation unknown – confirm onsite", ie);
  }

  // Roof / access – operational unless it proves a hard failure (handled under relevant ceiling)
  const ra = ev("roof_access", { fact: f.flatRoofOrAccessConcern ? "concern flagged" : "none detected", source: "properties.enrichment", basis: f.flatRoofOrAccessConcern ? "recorded" : "unknown" });
  if (f.flatRoofOrAccessConcern) {
    rule("roof_access", "Roof / access", "onsite", "Flat / low-slope roof or access concern – confirm roof cavity / exposed roof and access onsite (not a disqualifier)", ra);
    flags.push({ key: "roof_access_review", type: "operational", severity: "medium", reason: "Flat / low-slope roof or access concern – plan access and confirm cavity onsite" });
  } else rule("roof_access", "Roof / access", "info", "No flat-roof or access concern detected", ra);

  // Life support – safety flag only, never an eligibility result
  const ls = ev("life_support", { fact: f.lifeSupportStatus ?? "unknown", source: "jobs.life_support_status", basis: f.lifeSupportStatus && f.lifeSupportStatus !== "unknown" ? "declared" : "unknown" });
  rule("life_support", "Life support (safety)", "info", f.lifeSupportStatus === "yes" ? "Life support at property – safety flag" : f.lifeSupportStatus === "no" ? "No life support declared" : "Life-support status unknown – safety flag", ls);
  if (f.lifeSupportStatus === "yes") flags.push({ key: "life_support", type: "safety", severity: "high", reason: "Life-support arrangements must be managed before electrical work/power interruption" });
  else if (f.lifeSupportStatus !== "no") flags.push({ key: "life_support_unknown", type: "safety", severity: "medium", reason: "Life-support status unknown – confirm before electrical work/power interruption" });

  // Occupancy question retired from homeowner intake — no longer reported.

  // Area – never an eligibility failure
  rule("area", "Ceiling area", "info", "Final relevant ceiling area measured onsite", { fact: f.areaKnown ? "owner estimate" : "unknown", source: "jobs.estimated_area_m2", basis: f.areaKnown ? "declared" : "unknown" });
  if (f.areaKnown === false) flags.push({ key: "measure_required", type: "operational", severity: "low", reason: "Ceiling area unknown – measure onsite" });

  if (f.preliminaryOutcome) rule("preliminary", "Website preliminary result", "info", `Website screening said ${f.preliminaryOutcome.replace(/_/g, " ")} – information only`, { fact: f.preliminaryOutcome, source: "base44", basis: "declared" });

  // 2026 rollout restriction (not an eligibility result)
  const hold = rolloutHoldActive(f.referenceDate, !!f.publicHousingVerified);
  if (f.referenceDate && f.referenceDate < GENERAL_ROLLOUT_START)
    rule("rollout", "2026 rollout", "info", hold ? "Before 1 Oct 2026 only public/community housing – hold before assessment dispatch" : "Verified public/community housing – early rollout applies", { fact: f.publicHousingVerified ? "public/community housing (verified)" : "private/general", source: "rollout calendar", basis: f.publicHousingVerified ? "verified" : "unknown" });
  if (hold) flags.push({ key: "rollout_hold", type: "operational", severity: "high", reason: "General rollout starts 1 Oct 2026 – do not dispatch assessment before then" });

  const onsiteRequirements = [...new Set([...onsite, ...ONSITE_ALWAYS])];
  let outcome: CustomerOutcome | null, nextAction: string;
  const dispatch = hold ? "Hold until general rollout starts 1 Oct 2026, then assign installer for the free Ready Check" : "Assign installer for the free Ready Check";
  if (failed.length) { outcome = "does_not_appear_eligible"; nextAction = "Review automatic ineligibility evidence before closing / override with reason"; }
  else if (onsite.length) { outcome = "needs_onsite_confirmation"; nextAction = `${dispatch} – confirm onsite: ${onsite.join("; ")}`; }
  else { outcome = "likely_eligible"; nextAction = `${dispatch} – subject to onsite insulation, lighting and electrical confirmation`; }
  const reviewRequired = false; // simple Gate 1 never raises internal review
  return {
    ruleset_version: GATE1_RULESET_VERSION, outcome, internalStatus: reviewRequired ? "review_required" : "auto_decided", reviewRequired,
    passed, failed, review, onsite, onsiteRequirements, flags, rolloutHold: hold, rules, nextAction: nextAction.slice(0, 300), referenceDate: f.referenceDate ?? null,
  };
}

/** Audit JSON stored in jobs.eligibility_decision_rules. */
export function gate1Audit(d: Gate1Decision, facts: unknown, evaluatedAt: string) {
  return {
    ruleset_version: d.ruleset_version, customer_outcome: d.outcome, internal_status: d.internalStatus,
    hard_failures: d.failed, review_reasons: d.review, onsite_requirements: d.onsiteRequirements, onsite_drivers: d.onsite,
    flags: d.flags, rollout_hold: d.rolloutHold, rules: d.rules, next_action: d.nextAction,
    evaluated_at: evaluatedAt, reference_date: d.referenceDate, facts,
    // legacy keys kept for older readers
    rules_passed: d.passed, rules_failed: d.failed, needs_review: d.review, decided_at: evaluatedAt,
  };
}
/** Stable signature – re-evaluation writes only when this changes (idempotent sweeps). */
export function gate1Signature(d: Pick<Gate1Decision, "outcome" | "internalStatus" | "failed" | "review" | "onsite" | "flags" | "rolloutHold">) {
  return JSON.stringify([d.outcome, d.internalStatus, d.failed, d.review, d.onsite, d.flags.map((x) => x.key), d.rolloutHold]);
}

/** May the job progress past Gate 1? likely/onsite (system or admin) yes; review/fail/rollout-hold no. */
export function eligibilityConfirmedFor(j: { eligibility_outcome: string | null; eligibility_decision_source: string | null; eligibility_set_by?: string | null; eligibility_review_required?: boolean | null; eligibility_flags?: unknown }, today: string): boolean {
  const decided = !!j.eligibility_set_by || j.eligibility_decision_source === "system" || j.eligibility_decision_source === "admin";
  if (!decided || j.eligibility_review_required) return false;
  if (j.eligibility_outcome !== "likely_eligible" && j.eligibility_outcome !== "needs_onsite_confirmation") return false;
  const flags = Array.isArray(j.eligibility_flags) ? (j.eligibility_flags as Gate1Flag[]) : [];
  if (flags.some((x) => x?.key === "rollout_hold") && today < GENERAL_ROLLOUT_START) return false;
  return true;
}

// ---------- Fact resolution from stored property/intake data (pure) ----------
const RES_WORDS = /\b(house|townhouse|town house|unit|apartment|flat|villa|dwelling|residential|home|duplex|terrace|semi)/i;
const NONRES_WORDS = /\b(commercial|industrial|retail|office|warehouse|shop|non[- ]?residential|business)/i;
export function classifyPremises(v: unknown): "residential" | "non_residential" | null {
  if (typeof v !== "string" || !v.trim()) return null;
  if (NONRES_WORDS.test(v)) return "non_residential";
  if (RES_WORDS.test(v)) return "residential";
  return null;
}
const RESEARCH_DONE = new Set(["complete", "completed", "verified", "success", "done"]);

/** Geocoded formatted address "…, Suburb VIC 3336[, Australia]" vs intake postcode. */
export function geocodedVicMatch(formatted: unknown, intakePostcode: string | null): { match: boolean; conflict: boolean; postcode: string | null } {
  if (typeof formatted !== "string") return { match: false, conflict: false, postcode: null };
  const m = formatted.match(/\b(VIC|Victoria)\s+(\d{4})\b/i);
  if (!m) return { match: false, conflict: false, postcode: null };
  const pc = m[2]!, intake = intakePostcode?.trim() ?? null;
  if (!intake) return { match: false, conflict: false, postcode: pc };
  return { match: pc === intake, conflict: pc !== intake, postcode: pc };
}

/** Base44 answers.insulation -> none / present / unknown. */
export function normaliseInsulation(v: unknown): "none" | "present" | "unknown" | null {
  if (v === false) return "none"; if (v === true) return "present";
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim().toLowerCase();
  if (/^(none|no|no insulation|nothing|not present)$/.test(s)) return "none";
  if (/(unknown|unsure|not sure|don'?t know|dont know|maybe|n\/a)/.test(s)) return "unknown";
  return "present";
}
const yesNo = (v: unknown): "yes" | "no" | "unknown" | null => {
  if (v === true) return "yes"; if (v === false) return "no";
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return s === "yes" || s === "y" || s === "true" ? "yes" : s === "no" || s === "n" || s === "false" ? "no" : s ? "unknown" : null;
};

export type StoredProperty = { state: string | null; postcode: string | null; occupancy: string | null; is_residential: boolean | null; year_built: number | null; enrichment: Record<string, unknown> | null };

/** Current Property Intelligence fact as stored in property_facts. */
export type IntelFact = { fact_key: string; value: unknown; evidence_kind: string | null; confidence: string | null; source_type: string | null; source_name: string | null; source_url?: string | null; is_current: boolean; is_stale: boolean };
/** Only direct, high-confidence, current, externally sourced facts may SET a Gate 1 fact. Zoning/inferred facts never do. */
export function trustedIntel(f: IntelFact | undefined): f is IntelFact {
  return !!f && f.is_current && !f.is_stale && f.evidence_kind === "direct" && (f.confidence === "high" || f.confidence === "very_high")
    && ["public_gis", "partner", "provider"].includes(f.source_type ?? "");
}
const intelSrc = (f: IntelFact) => `property intelligence: ${f.source_name ?? f.source_type}${f.source_url ? ` (${f.source_url})` : ""}`;

export type Gate1JobInput = { lifeSupportStatus: string | null; preliminaryOutcome: string | null; referenceDate?: string | null; areaUnknown?: boolean | null };

export function resolveGate1Facts(p: StoredProperty | null, job: Gate1JobInput, minAge: number, currentYear: number, intel: IntelFact[] = []): Gate1Facts {
  void intel; // property intelligence retired (4 Oct 2026) – never feeds Gate 1
  return resolveBaseFacts(p, job, minAge, currentYear);
}

/** Property Intelligence feeds Gate 1 only where the portal/Base44 left a fact unknown AND the evidence is trusted. Raising review is always allowed. */
export function applyIntelligence(f: Gate1Facts, intel: IntelFact[], currentYear: number): Gate1Facts {
  const cur = intel.filter((i) => i.is_current && !i.is_stale);
  const get = (k: string) => cur.find((i) => i.fact_key === k);
  const out: Gate1Facts = { ...f, evidence: { ...(f.evidence ?? {}) } };
  const ev = out.evidence!;
  const inVic = get("in_victoria"), addr = get("address_verified");
  if (!out.state && trustedIntel(inVic) && trustedIntel(addr) && addr.value === true && typeof inVic.value === "boolean") {
    out.state = inVic.value ? "VIC" : "OUTSIDE VIC";
    ev.location = { fact: inVic.value ? "Victoria (verified address)" : "outside Victoria (verified address)", source: intelSrc(inVic), basis: "verified" };
  }
  if (addr && addr.value === false && !ev.location?.basis.startsWith("verified")) {
    out.addressAmbiguous = true;
    ev.address = { fact: "address not uniquely matched", source: intelSrc(addr), basis: "recorded" };
  }
  if (trustedIntel(addr) && addr.value === true && trustedIntel(inVic) && inVic.value === true) out.addressVerifiedVic = true;
  const ncc = get("ncc_class_evidence");
  if (out.declaredHouse && trustedIntel(ncc) && ncc.value === "not_eligible") {
    out.declaredHouse = false; out.residentialNote = "Owner type conflicts with trusted NCC class evidence – review";
  }
  if (out.isResidential == null && !out.residentialNote && trustedIntel(ncc)) {
    if (ncc.value === "class1" || ncc.value === "class2_sou") { out.isResidential = true; ev.residential = { fact: `NCC ${ncc.value}`, source: intelSrc(ncc), basis: "verified" }; }
    else if (ncc.value === "not_eligible") { out.isResidential = false; ev.residential = { fact: "not Class 1 / Class 2 SOU", source: intelSrc(ncc), basis: "verified" }; }
  } else if (out.isResidential === true && trustedIntel(ncc) && ncc.value === "not_eligible" && ev.residential?.basis === "declared") {
    out.isResidential = null; out.residentialNote = "Owner type conflicts with trusted NCC class evidence – review";
  }
  const age = get("age_evidence");
  if (out.yearBuilt == null && out.verifiedMinAgeYears == null && trustedIntel(age)) {
    const v = age.value as { date?: string | null; kind?: string } | null;
    const yr = v?.date ? new Date(v.date).getFullYear() : null;
    if (yr && (v?.kind === "historical_imagery_same_footprint" || v?.kind === "direct_record")) {
      if (v.kind === "direct_record") { out.yearBuilt = yr; out.yearBuiltVerified = true; }
      else out.verifiedMinAgeYears = currentYear - yr;
      ev.ceiling_age = { fact: `${v.kind === "direct_record" ? "built" : "first appears"} ${yr}`, source: intelSrc(age), basis: "verified" };
    }
  }
  const ext = get("recent_extension_or_added_storey_risk");
  if (ext?.value === "yes" && out.recentExtensionRisk !== "yes") {
    out.recentExtensionRisk = "yes";
    ev.ceiling_age = { fact: `${ev.ceiling_age?.fact ?? "age"}; recent extension risk`, source: intelSrc(ext), basis: trustedIntel(ext) ? "verified" : "recorded" };
  }
  const nrc = get("no_relevant_ceiling");
  if (trustedIntel(nrc) && nrc.value === true) { out.noRelevantCeilingDirect = true; ev.relevant_ceiling = { fact: "no relevant ceiling", source: intelSrc(nrc), basis: "verified" }; }
  const storey = get("another_storey_above_relevant_ceiling");
  if (storey?.value === "yes" && !out.noRelevantCeilingDirect) { out.storeyAboveIndicated = true; ev.relevant_ceiling = { fact: "storey above part of ceiling", source: intelSrc(storey), basis: trustedIntel(storey) ? "verified" : "recorded" }; }
  const roof = get("roof_form");
  if (!out.flatRoofOrAccessConcern && (roof?.value === "low_slope_flat" || roof?.value === "mixed")) {
    out.flatRoofOrAccessConcern = true;
    ev.roof_access = { fact: `roof form ${roof.value}`, source: intelSrc(roof), basis: trustedIntel(roof) ? "verified" : "recorded" };
  }
  const pa = get("previous_activity_48_confirmed");
  if (trustedIntel(pa) && pa.value === true) { out.previousActivity48Confirmed = true; ev.previous_activity = { fact: "previous Activity 48 confirmed", source: intelSrc(pa), basis: "verified" }; }
  const ph = get("public_community_housing");
  if (trustedIntel(ph) && ph.value === true) out.publicHousingVerified = true;
  return out;
}

function resolveBaseFacts(p: StoredProperty | null, job: Gate1JobInput, minAge: number, currentYear: number): Gate1Facts {
  const e = (p?.enrichment ?? {}) as Record<string, unknown>;
  const b = (e["base44"] ?? {}) as { declared?: Record<string, unknown>; research?: Record<string, unknown>; raw?: { answers?: Record<string, unknown> } };
  const d = b.declared ?? {}, r: Record<string, unknown> = {}, answers = b.raw?.answers ?? {};
  const researchDone = typeof r["status"] === "string" && RESEARCH_DONE.has((r["status"] as string).toLowerCase());
  const evidence: Partial<Record<RuleKey, FactEvidence>> = {};

  // Location: portal columns first, then Base44 mapped address (geocoded, treated as verified).
  let state = p?.state ?? null, postcode = p?.postcode ?? null;
  let mapped = false;
  if (!state && typeof r["state"] === "string") { state = r["state"] as string; mapped = true; }
  if (!postcode && typeof r["postcode"] === "string") { postcode = r["postcode"] as string; mapped = true; }
  if (state || postcode) evidence.location = mapped
    ? { fact: `${[state, postcode].filter(Boolean).join(" ")}${r["formatted_address"] ? ` (${r["formatted_address"]})` : ""}`, source: "base44.property_research mapped address", basis: "verified" }
    : { fact: [state, postcode].filter(Boolean).join(" "), source: "properties (intake address)", basis: "recorded" };
  const addressAmbiguous = r["address_ambiguous"] === true || r["address_match"] === "ambiguous";
  if (addressAmbiguous) evidence.address = { fact: "ambiguous address match", source: "base44.property_research", basis: "recorded" };

  // Residential
  let isResidential = p?.is_residential ?? null, residentialNote: string | null = null;
  const declaredType = typeof d["property_type"] === "string" ? (d["property_type"] as string) : null;
  const declaredClass = classifyPremises(declaredType);
  const researchClass = researchDone ? classifyPremises(r["premises_classification"]) : null;
  if (isResidential != null) evidence.residential = { fact: String(isResidential), source: "properties.is_residential", basis: "recorded" };
  else if (researchClass === "residential" && declaredClass !== "non_residential") {
    isResidential = true;
    evidence.residential = { fact: `research: ${r["premises_classification"]}${declaredType ? `; owner: ${declaredType}` : ""}`, source: "base44.property_research", basis: "verified" };
  } else if (researchClass || declaredClass) {
    residentialNote = researchClass === "non_residential" ? "Property research suggests non-residential premises – confirm (not an auto-fail)"
      : researchClass === "residential" ? "Owner type conflicts with residential research – review"
      : `Owner declares ${declaredType} – not verified by property research`;
    evidence.residential = { fact: [researchClass && `research: ${r["premises_classification"]}`, declaredType && `owner: ${declaredType}`].filter(Boolean).join("; "), source: researchClass ? "base44.property_research" : "base44 owner declaration", basis: researchClass ? "verified" : "declared" };
  }
  // Geocoded research address (any research status): VIC + postcode matching the intake postcode
  // verifies the Victorian premises for the preliminary declared-house rule. A postcode conflict never verifies.
  const geo = geocodedVicMatch(r["formatted_address"], postcode);
  if (geo.conflict && residentialNote?.startsWith("Owner declares")) residentialNote = `Owner declares ${declaredType}; geocoded address postcode ${geo.postcode} conflicts with intake postcode ${postcode} – confirm the premises`;

  // Relevant ceiling / structure age
  const yearBuiltVerified = e["year_built_verified"] === true;
  const fa = typeof r["first_appearance_year"] === "number" ? (r["first_appearance_year"] as number) : null;
  const verifiedMinAgeYears = researchDone && r["age_verified"] === true && fa ? currentYear - fa : null;
  const declaredOverMinAge = (["yes", "no", "unknown"].includes(d["over_five_years"] as string) ? d["over_five_years"] : null) as "yes" | "no" | "unknown" | null;
  if (p?.year_built) evidence.ceiling_age = { fact: `built ${p.year_built}`, source: "properties.year_built", basis: yearBuiltVerified ? "verified" : "recorded" };
  else if (verifiedMinAgeYears != null) evidence.ceiling_age = { fact: `first appears ${fa}${r["age_evidence_source"] ? ` (${r["age_evidence_source"]})` : ""}`, source: "base44.property_research", basis: "verified" };
  else if (declaredOverMinAge) evidence.ceiling_age = { fact: `owner: over 5 years = ${declaredOverMinAge}`, source: "base44 owner declaration", basis: "declared" };
  const recentExtensionRisk = r["recent_extension_detected"] === true || e["recent_extension_risk"] === true ? "yes" : null;

  // Previous upgrade / Activity 48
  let previousCeilingUpgrade: boolean | null = typeof e["previous_ceiling_insulation_upgrade"] === "boolean" ? (e["previous_ceiling_insulation_upgrade"] as boolean) : null;
  if (previousCeilingUpgrade != null) evidence.previous_activity = { fact: previousCeilingUpgrade ? "yes" : "no", source: "properties.enrichment", basis: "recorded" };
  else if (d["previous_upgrade"] === "yes" || d["previous_upgrade"] === "no") {
    previousCeilingUpgrade = d["previous_upgrade"] === "yes";
    evidence.previous_activity = { fact: `owner: ${d["previous_upgrade"]}`, source: "base44 owner declaration", basis: "declared" };
  }
  const previousActivity48Confirmed = e["previous_activity_48_confirmed"] === true;

  // Relevant ceiling
  const extras = declaredExtras(answers); // ONE Step 1 → Step 2 mapping, shared with the intake summary
  const declaredTopFloor = yesNo(extras.top_floor);
  const noRelevantCeilingDirect = e["no_relevant_ceiling"] === true;
  if (noRelevantCeilingDirect) evidence.relevant_ceiling = { fact: "no relevant ceiling", source: "properties.enrichment", basis: "recorded" };

  // Insulation
  const declaredInsulation = normaliseInsulation(extras.existing_insulation);
  const vi = e["insulation_verified"];
  const verifiedInsulation = vi === "qualifying" || vi === "disqualifying" ? vi : null;

  const detectedFlat = r["flat_roof_detected"] === true || r["access_concern_detected"] === true;
  const flat = e["flat_roof"] === true || e["access_concern"] === true || detectedFlat;
  if (flat) evidence.roof_access = { fact: "flat roof / access concern", source: detectedFlat ? "base44.property_research" : "properties.enrichment", basis: detectedFlat ? "verified" : "recorded" };

  return {
    state, postcode, occupancy: p?.occupancy ?? null, isResidential, yearBuilt: p?.year_built ?? null, yearBuiltVerified,
    minBuildingAgeYears: minAge, lifeSupportStatus: job.lifeSupportStatus, previousCeilingUpgrade, flatRoofOrAccessConcern: flat,
    preliminaryOutcome: job.preliminaryOutcome, currentYear, verifiedMinAgeYears, declaredOverMinAge, residentialNote, evidence,
    addressAmbiguous, declaredPropertyType: declaredType,
    declaredHouse: researchClass == null && isResidential == null && !!declaredType && /\b(house|townhouse|town house)\b/i.test(declaredType) && !APARTMENT.test(declaredType),
    addressVerifiedVic: geo.conflict ? false : (evidence.location?.basis === "verified" && state?.toUpperCase() === "VIC") || geo.match, declaredTopFloor, noRelevantCeilingDirect, recentExtensionRisk,
    previousActivity48Confirmed, declaredInsulation, verifiedInsulation, areaKnown: job.areaUnknown == null ? null : !job.areaUnknown,
    publicHousingVerified: e["public_community_housing_verified"] === true, referenceDate: job.referenceDate ?? null,
  };
}
