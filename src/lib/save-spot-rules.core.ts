// P1-R3-S103: Office-configurable AUTOMATIC Save-my-spot sending rules. PURE: no I/O, no sending.
//
// SCOPE (owner instruction): these rules are ADDITIONAL restrictions only. They can never widen what the
// live automatic router already allows, and they can never switch delivery on. Every mandatory safety
// control (COM-04 master switch, the Save-my-spot secondary switch, consent, opt-out/suppression,
// duplicate/idempotency, uncertain-delivery protection, approved templates, the mandatory eligibility
// exclusions in automaticLeadEmail, the S102 service-coverage gate, the S102 test-recipient boundary
// and sender permissions) lives outside this file and is unaffected by anything configured here.
//
// COMBINATION: AND across categories, OR inside a category. There is deliberately NO rule-expression
// language, no script, no raw SQL and no free-text condition.
//
// STORAGE-SHAPE NOTES: the persisted blob is `workflow_settings.save_my_spot_auto_rules` (jsonb, the
// single-column shape already used by `sms_message_switches`). An absent / empty / unreadable / invalid
// blob is NOT configured, and every caller must treat that as "do not automatically send".

import { STAGE_LABEL } from "./workflow";

/** Bumped only if the persisted shape changes; an unknown version is invalid, never partially applied. */
export const AUTOMATIC_RULES_VERSION = 1;

export const FILTER_CATEGORIES = ["eligibility", "insulation", "ceilingArea", "postcode", "jobStatus", "enquiryDate"] as const;
export type FilterCategory = (typeof FILTER_CATEGORIES)[number];

// ---------- Filter value sets: existing CRM vocabularies only, nothing invented ----------

/** The three recorded Gate 1 customer outcomes (`eligibility_outcome`). */
export const ELIGIBILITY_OUTCOMES = ["likely_eligible", "needs_onsite_confirmation", "does_not_appear_eligible"] as const;
export type EligibilityOutcomeValue = (typeof ELIGIBILITY_OUTCOMES)[number];
export const ELIGIBILITY_LABEL: Record<EligibilityOutcomeValue, string> = {
  likely_eligible: "Likely eligible",
  needs_onsite_confirmation: "Needs onsite confirmation",
  does_not_appear_eligible: "Does not appear eligible",
};

/** The canonical owner answer normalisation (eligibility.core normaliseInsulation): none | present | unknown. */
export const INSULATION_VALUES = ["none", "present", "unknown"] as const;
export type InsulationValue = (typeof INSULATION_VALUES)[number];
export const INSULATION_LABEL: Record<InsulationValue, string> = {
  none: "No existing insulation",
  present: "Existing insulation present",
  unknown: "Owner not sure / unknown",
};

/**
 * Job statuses the Office may choose from: the existing enquiry stages where a first Save-my-spot
 * reply is still the right next step (`ENQUIRY_STAGES`, enquiry-groups.core). Closed, on-hold and
 * retired stages are NOT offered and can never be configured (see LIFECYCLE_EXCLUDED_STAGES).
 */
export const SELECTABLE_JOB_STATUSES = ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_ready_to_schedule"] as const;
export type SelectableJobStatus = (typeof SELECTABLE_JOB_STATUSES)[number];
export const jobStatusLabel = (stage: string): string => STAGE_LABEL[stage as keyof typeof STAGE_LABEL] ?? stage.replace(/_/g, " ");

/** Mandatory lifecycle exclusions. Never configurable and never bypassable by a rule set. */
export const LIFECYCLE_EXCLUDED_STAGES = new Set([
  "cancelled", "complete", "on_hold",
  "awaiting_electrician", "assessment_booking", "assessment_booked", "assessment_complete", // retired legacy stages
]);

export const ENQUIRY_DATE_WINDOWS = ["last_1_day", "last_3_days", "last_7_days", "custom"] as const;
export type EnquiryDateWindow = (typeof ENQUIRY_DATE_WINDOWS)[number];
export const ENQUIRY_DATE_LABEL: Record<EnquiryDateWindow, string> = {
  last_1_day: "Last 1 day", last_3_days: "Last 3 days", last_7_days: "Last 7 days", custom: "Custom range",
};
const RELATIVE_WINDOW_DAYS: Record<Exclude<EnquiryDateWindow, "custom">, number> = { last_1_day: 1, last_3_days: 3, last_7_days: 7 };

export const POSTCODE_RANGE_MIN = 0;
export const POSTCODE_RANGE_MAX = 9999;
/** jobs.estimated_area_m2 is bounded at intake by the existing 0 < area <= 5000 invariant. */
export const CEILING_AREA_MAX_M2 = 5000;
const POSTCODE = /^[0-9]{4}$/;
const DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// ---------- Configuration shape ----------

export type EligibilityFilter = { enabled: boolean; outcomes: EligibilityOutcomeValue[] };
export type InsulationFilter = { enabled: boolean; values: InsulationValue[] };
export type CeilingAreaFilter = { enabled: boolean; minM2: number | null; maxM2: number | null; includeUnknownArea: boolean };
export type PostcodeFilter = { enabled: boolean; mode: "specific" | "range"; postcodes: string[]; rangeFrom: string | null; rangeTo: string | null };
export type JobStatusFilter = { enabled: boolean; stages: SelectableJobStatus[] };
export type EnquiryDateFilter = { enabled: boolean; window: EnquiryDateWindow; fromDate: string | null; toDate: string | null };

export type AutomaticRuleFilters = {
  eligibility: EligibilityFilter;
  insulation: InsulationFilter;
  ceilingArea: CeilingAreaFilter;
  postcode: PostcodeFilter;
  jobStatus: JobStatusFilter;
  enquiryDate: EnquiryDateFilter;
};

/** The persisted document. `enabled` is the automatic-selection control, DISTINCT from the COM-04 switches. */
export type AutomaticRulesConfig = {
  version: number;
  enabled: boolean;
  rules: AutomaticRuleFilters;
  updatedAt: string | null;
  updatedBy: string | null;
  /** When automatic selection was last switched on. New rules only apply to enquiries created at/after this. */
  activatedAt: string | null;
};

export const DEFAULT_FILTERS: AutomaticRuleFilters = {
  eligibility: { enabled: false, outcomes: [] },
  insulation: { enabled: false, values: [] },
  ceilingArea: { enabled: false, minM2: null, maxM2: null, includeUnknownArea: false },
  postcode: { enabled: false, mode: "specific", postcodes: [], rangeFrom: null, rangeTo: null },
  jobStatus: { enabled: false, stages: [] },
  enquiryDate: { enabled: false, window: "last_3_days", fromDate: null, toDate: null },
};

export const defaultFilters = (): AutomaticRuleFilters => JSON.parse(JSON.stringify(DEFAULT_FILTERS)) as AutomaticRuleFilters;

// ---------- Validation (pure) ----------

export type ValidationResult = { ok: true; value: AutomaticRuleFilters } | { ok: false; errors: string[] };

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const boolOr = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);
const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const numberField = (v: unknown, label: string, errors: string[]): number | null => {
  if (v == null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) { errors.push(`${label} ceiling area must be a number in m².`); return null; }
  return v;
};
const stringList = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()))] : []);

export const CATEGORY_LABEL: Record<FilterCategory, string> = {
  eligibility: "Eligibility outcome",
  insulation: "Existing insulation",
  ceilingArea: "Ceiling area",
  postcode: "Postcode",
  jobStatus: "Job status",
  enquiryDate: "Enquiry date",
};

/**
 * Accepts untrusted input (Office form / stored blob) and returns either a clean filter set or every
 * reason it is unusable. Never throws, never partially accepts: an unknown value is an error, not a
 * silently dropped condition, and a disabled filter may hold anything harmless.
 */
export function validateFilters(input: unknown): ValidationResult {
  const root = asRecord(input);
  if (!root) return { ok: false, errors: ["The rule configuration is not a readable object."] };
  const errors: string[] = [];
  const pick = (key: FilterCategory): Record<string, unknown> => asRecord(root[key]) ?? {};

  // A – Eligibility outcome
  const el = pick("eligibility");
  const elEnabled = boolOr(el["enabled"], false);
  const elOutcomes: EligibilityOutcomeValue[] = [];
  for (const raw of stringList(el["outcomes"])) {
    if ((ELIGIBILITY_OUTCOMES as readonly string[]).includes(raw)) elOutcomes.push(raw as EligibilityOutcomeValue);
    else errors.push(`Unknown eligibility outcome "${raw}".`);
  }
  if (elEnabled && !elOutcomes.length) errors.push("Choose at least one eligibility outcome.");

  // B – Existing insulation
  const ins = pick("insulation");
  const insEnabled = boolOr(ins["enabled"], false);
  const insValues: InsulationValue[] = [];
  for (const raw of stringList(ins["values"])) {
    if ((INSULATION_VALUES as readonly string[]).includes(raw)) insValues.push(raw as InsulationValue);
    else errors.push(`Unknown existing-insulation value "${raw}".`);
  }
  if (insEnabled && !insValues.length) errors.push("Choose at least one existing-insulation answer.");

  // C – Ceiling area (optional min/max on the existing recorded area; unknown area explicit)
  const area = pick("ceilingArea");
  const areaEnabled = boolOr(area["enabled"], false);
  const minM2 = numberField(area["minM2"], "Minimum", errors);
  const maxM2 = numberField(area["maxM2"], "Maximum", errors);
  for (const [label, v] of [["Minimum", minM2], ["Maximum", maxM2]] as const) {
    if (areaEnabled && v !== null && (v <= 0 || v > CEILING_AREA_MAX_M2)) errors.push(`${label} ceiling area must be between 0 and ${CEILING_AREA_MAX_M2} m².`);
  }
  if (areaEnabled && minM2 !== null && maxM2 !== null && minM2 > maxM2) errors.push("Minimum ceiling area cannot be greater than the maximum.");
  if (!areaEnabled && (area["minM2"] != null || area["maxM2"] != null)) errors.push("Set a minimum or maximum ceiling area only when the ceiling-area filter is on.");

  // D – Postcode
  const pc = pick("postcode");
  const pcEnabled = boolOr(pc["enabled"], false);
  const pcMode: "specific" | "range" = pc["mode"] === "range" ? "range" : "specific";
  const postcodes: string[] = [];
  for (const raw of stringList(pc["postcodes"])) {
    if (POSTCODE.test(raw)) postcodes.push(raw);
    else errors.push(`"${raw}" is not a 4-digit Australian postcode.`);
  }
  const rangeFrom = typeof pc["rangeFrom"] === "string" && pc["rangeFrom"].trim() ? pc["rangeFrom"].trim() : null;
  const rangeTo = typeof pc["rangeTo"] === "string" && pc["rangeTo"].trim() ? pc["rangeTo"].trim() : null;
  for (const [label, v] of [["Start", rangeFrom], ["End", rangeTo]] as const) {
    if (pcEnabled && pcMode === "range" && (v === null || !POSTCODE.test(v))) errors.push(`${label} postcode must be a 4-digit Australian postcode.`);
  }
  if (pcEnabled && pcMode === "range" && rangeFrom && rangeTo && rangeFrom > rangeTo) errors.push("Start postcode cannot be after the end postcode.");
  if (pcEnabled && pcMode === "specific" && !postcodes.length) errors.push("Add at least one postcode, or choose a postcode range.");
  if (pcEnabled && pcMode === "range" && postcodes.length) errors.push("Use either specific postcodes or a postcode range, not both.");

  // E – Job status (existing enquiry stages only)
  const js = pick("jobStatus");
  const jsEnabled = boolOr(js["enabled"], false);
  const stages: SelectableJobStatus[] = [];
  for (const raw of stringList(js["stages"])) {
    if ((SELECTABLE_JOB_STATUSES as readonly string[]).includes(raw)) stages.push(raw as SelectableJobStatus);
    else errors.push(`"${jobStatusLabel(raw)}" is not a job status that can receive a Save my spot email.`);
  }
  if (jsEnabled && !stages.length) errors.push("Choose at least one job status.");

  // F – Enquiry date (from the existing jobs.created_at enquiry timestamp)
  const ed = pick("enquiryDate");
  const edEnabled = boolOr(ed["enabled"], false);
  const rawWindow = typeof ed["window"] === "string" ? ed["window"] : "last_3_days";
  const window: EnquiryDateWindow = (ENQUIRY_DATE_WINDOWS as readonly string[]).includes(rawWindow) ? (rawWindow as EnquiryDateWindow) : "last_3_days";
  if (edEnabled && !(ENQUIRY_DATE_WINDOWS as readonly string[]).includes(rawWindow)) errors.push(`Unknown enquiry-date window "${rawWindow}".`);
  const fromDate = typeof ed["fromDate"] === "string" && String(ed["fromDate"]).trim() ? String(ed["fromDate"]).trim() : null;
  const toDate = typeof ed["toDate"] === "string" && String(ed["toDate"]).trim() ? String(ed["toDate"]).trim() : null;
  if (edEnabled && window === "custom") {
    for (const [label, v] of [["Start", fromDate], ["End", toDate]] as const) {
      if (v === null || !DATE.test(v)) errors.push(`${label} date must be a real date (YYYY-MM-DD).`);
    }
    if (fromDate && DATE.test(fromDate) && toDate && DATE.test(toDate) && fromDate > toDate) errors.push("Start date cannot be after the end date.");
  }
  if (edEnabled && window !== "custom" && (fromDate || toDate)) errors.push("Use the relative windows, or switch to a custom range.");

  if (errors.length) return { ok: false, errors };
  const cleanPostcodes = pcEnabled && pcMode === "specific" ? postcodes : [];
  return {
    ok: true,
    value: {
      eligibility: { enabled: elEnabled, outcomes: [...new Set(elOutcomes)] },
      insulation: { enabled: insEnabled, values: [...new Set(insValues)] },
      ceilingArea: { enabled: areaEnabled, minM2: areaEnabled ? minM2 : null, maxM2: areaEnabled ? maxM2 : null, includeUnknownArea: boolOr(area["includeUnknownArea"], false) },
      postcode: { enabled: pcEnabled, mode: pcEnabled ? pcMode : "specific", postcodes: cleanPostcodes, rangeFrom: pcEnabled && pcMode === "range" ? rangeFrom : null, rangeTo: pcEnabled && pcMode === "range" ? rangeTo : null },
      jobStatus: { enabled: jsEnabled, stages: [...new Set(stages)] },
      enquiryDate: { enabled: edEnabled, window, fromDate: edEnabled && window === "custom" ? fromDate : null, toDate: edEnabled && window === "custom" ? toDate : null },
    },
  };
}

/** Validate a whole persisted document (including its version). An unusable document is never partially read. */
export function validateConfig(input: unknown): ValidationResult & { enabled: boolean; activatedAt: string | null } {
  const root = asRecord(input);
  if (!root) return { ok: false, errors: ["The stored rule configuration is not a readable object."], enabled: false, activatedAt: null };
  if (root["version"] !== AUTOMATIC_RULES_VERSION) return { ok: false, errors: [`Unsupported rule configuration version (expected ${AUTOMATIC_RULES_VERSION}).`], enabled: false, activatedAt: null };
  const filters = validateFilters(root["rules"]);
  if (!filters.ok) return { ok: false, errors: filters.errors, enabled: false, activatedAt: null };
  return {
    ok: true,
    value: filters.value,
    enabled: root["enabled"] === true,
    activatedAt: typeof root["activatedAt"] === "string" && String(root["activatedAt"]).trim() ? String(root["activatedAt"]).trim() : null,
  };
}

// ---------- Matching (pure) ----------

/** Only existing recorded facts are read. Nothing here is inferred or defaulted into a match. */
export type AutomaticSaveSpotFacts = {
  eligibilityOutcome: string | null;
  insulation: InsulationValue | null;
  /** Recorded ceiling area in m² (jobs.estimated_area_m2 when the owner supplied one). */
  areaM2: number | null;
  areaUnknown: boolean;
  postcode: string | null;
  stage: string | null;
  /** The existing authoritative enquiry timestamp (jobs.created_at). */
  createdAt: string | null;
};

export type RuleMatch = { eligible: boolean; failedCategories: FilterCategory[] };

const withinPostcodeRange = (value: string, from: string | null, to: string | null): boolean =>
  !!from && !!to && value >= from && value <= to;

/** OR inside one category. A disabled category always passes and never restricts. */
export function categoryPasses(category: FilterCategory, facts: AutomaticSaveSpotFacts, rules: AutomaticRuleFilters, nowMs: number): boolean {
  switch (category) {
    case "eligibility": {
      if (!rules.eligibility.enabled) return true;
      return !!facts.eligibilityOutcome && (rules.eligibility.outcomes as readonly string[]).includes(facts.eligibilityOutcome);
    }
    case "insulation": {
      if (!rules.insulation.enabled) return true;
      return !!facts.insulation && (rules.insulation.values as readonly string[]).includes(facts.insulation);
    }
    case "ceilingArea": {
      if (!rules.ceilingArea.enabled) return true;
      if (facts.areaUnknown || facts.areaM2 == null || !Number.isFinite(facts.areaM2)) return rules.ceilingArea.includeUnknownArea;
      const min = rules.ceilingArea.minM2;
      const max = rules.ceilingArea.maxM2;
      if (min != null && facts.areaM2 < min) return false;
      if (max != null && facts.areaM2 > max) return false;
      return true;
    }
    case "postcode": {
      if (!rules.postcode.enabled) return true;
      const pc = (facts.postcode ?? "").trim();
      if (!POSTCODE.test(pc)) return false; // unknown postcode is never a postcode match
      if (rules.postcode.mode === "range") return withinPostcodeRange(pc, rules.postcode.rangeFrom, rules.postcode.rangeTo);
      return rules.postcode.postcodes.includes(pc);
    }
    case "jobStatus": {
      if (!rules.jobStatus.enabled) return true;
      return !!facts.stage && (rules.jobStatus.stages as readonly string[]).includes(facts.stage);
    }
    case "enquiryDate": {
      if (!rules.enquiryDate.enabled) return true;
      const created = facts.createdAt ? Date.parse(facts.createdAt) : NaN;
      if (!Number.isFinite(created)) return false; // unknown enquiry date is never a date match
      if (rules.enquiryDate.window === "custom") {
        const day = new Date(created).toISOString().slice(0, 10);
        if (rules.enquiryDate.fromDate && day < rules.enquiryDate.fromDate) return false;
        if (rules.enquiryDate.toDate && day > rules.enquiryDate.toDate) return false;
        return true;
      }
      const days = RELATIVE_WINDOW_DAYS[rules.enquiryDate.window];
      return nowMs - created <= days * 86_400_000;
    }
  }
}

/** Mandatory lifecycle exclusion. Independent of configuration; returns a plain-English reason or null. */
export function lifecycleExclusion(stage: string | null | undefined): string | null {
  if (!stage) return "Job status is not recorded.";
  if (LIFECYCLE_EXCLUDED_STAGES.has(stage)) return `${stage === "cancelled" ? "Cancelled" : stage === "complete" ? "Complete" : stage === "on_hold" ? "On hold" : jobStatusLabel(stage)} is outside automatic Save my spot sending.`;
  return null;
}

/** The manually-approved backlog run only: the same filters without the enquiry-date window or job-status filter (Jo, 19 Oct). The mandatory lifecycle exclusion still applies. */
export function backlogRules(rules: AutomaticRuleFilters): AutomaticRuleFilters {
  return { ...rules, enquiryDate: { ...rules.enquiryDate, enabled: false }, jobStatus: { ...rules.jobStatus, enabled: false } };
}

/** AND across the enabled categories. A missing record never matches an enabled filter. */
export function matchAutomaticRules(facts: AutomaticSaveSpotFacts, rules: AutomaticRuleFilters, nowMs: number): RuleMatch {
  const failedCategories = FILTER_CATEGORIES.filter((c) => !categoryPasses(c, facts, rules, nowMs));
  return { eligible: failedCategories.length === 0, failedCategories };
}

export const CATEGORY_MISMATCH_REASON: Record<FilterCategory, string> = {
  eligibility: "Outside the chosen eligibility outcomes",
  insulation: "Outside the chosen existing-insulation answers",
  ceilingArea: "Outside the chosen ceiling-area range",
  postcode: "Outside the chosen postcodes",
  jobStatus: "Not in a chosen job status",
  enquiryDate: "Outside the chosen enquiry-date window",
};

/** Why a configured filter could not be satisfied because a record is unknown (Office should review it). */
export const CATEGORY_UNKNOWN_REASON: Record<FilterCategory, string> = {
  eligibility: "No eligibility result is recorded",
  insulation: "The owner’s existing-insulation answer is not recorded",
  ceilingArea: "No ceiling area is recorded",
  postcode: "No postcode is recorded",
  jobStatus: "Job status is not recorded",
  enquiryDate: "No enquiry date is recorded",
};

/** Categories whose failure is caused by a missing record rather than a definite mismatch. */
export function unknownCategories(facts: AutomaticSaveSpotFacts, rules: AutomaticRuleFilters, failed: FilterCategory[]): FilterCategory[] {
  return failed.filter((c) => {
    switch (c) {
      case "eligibility": return !facts.eligibilityOutcome;
      case "insulation": return !facts.insulation;
      case "ceilingArea": return facts.areaUnknown || facts.areaM2 == null;
      case "postcode": return !(facts.postcode ?? "").trim();
      case "jobStatus": return !facts.stage;
      case "enquiryDate": return !facts.createdAt;
    }
  });
}

/** Every enabled category, in plain English — shown on the Office screen and in the audit summary. */
export function describeRules(rules: AutomaticRuleFilters): string[] {
  const lines: string[] = [];
  for (const c of FILTER_CATEGORIES) {
    switch (c) {
      case "eligibility":
        if (rules.eligibility.enabled) lines.push(`Eligibility: ${rules.eligibility.outcomes.map((o) => ELIGIBILITY_LABEL[o]).join(" or ")}`);
        break;
      case "insulation":
        if (rules.insulation.enabled) lines.push(`Existing insulation: ${rules.insulation.values.map((v) => INSULATION_LABEL[v]).join(" or ")}`);
        break;
      case "ceilingArea": {
        if (!rules.ceilingArea.enabled) break;
        const { minM2, maxM2, includeUnknownArea } = rules.ceilingArea;
        const range = minM2 != null && maxM2 != null ? `${minM2}–${maxM2} m²` : minM2 != null ? `${minM2} m² or more` : maxM2 != null ? `${maxM2} m² or less` : "any recorded area";
        lines.push(`Ceiling area: ${range}${includeUnknownArea ? " (enquiries with no recorded area included)" : ""}`);
        break;
      }
      case "postcode":
        if (rules.postcode.enabled) lines.push(rules.postcode.mode === "range" ? `Postcode: ${rules.postcode.rangeFrom}–${rules.postcode.rangeTo}` : `Postcode: ${rules.postcode.postcodes.join(", ")}`);
        break;
      case "jobStatus":
        if (rules.jobStatus.enabled) lines.push(`Job status: ${rules.jobStatus.stages.map(jobStatusLabel).join(" or ")}`);
        break;
      case "enquiryDate": {
        if (!rules.enquiryDate.enabled) break;
        const { window, fromDate, toDate } = rules.enquiryDate;
        lines.push(`Enquiry date: ${window === "custom" ? `${fromDate} to ${toDate}` : ENQUIRY_DATE_LABEL[window]}`);
        break;
      }
    }
  }
  return lines.length ? lines : ["No extra filters — every enquiry the automatic router already allows."];
}