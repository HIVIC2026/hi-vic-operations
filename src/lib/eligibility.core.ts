// Pure, deterministic Gate 1 auto-decision. Risk-based: auto PASS only when every required fact is clearly
// satisfied from recorded data; auto FAIL only on an objective hard rule; everything else -> human review.
// Base44 preliminary screening is never sufficient on its own. Owner declarations are never "verified".

export type FactBasis = "verified" | "recorded" | "declared" | "unknown";
export type FactEvidence = { fact: string; source: string; basis: FactBasis };
export type RuleKey = "location" | "residential" | "building_age" | "occupancy" | "life_support" | "previous_upgrade" | "roof_access" | "preliminary";
export type RuleEvidence = FactEvidence & { key: RuleKey; label: string; result: "pass" | "fail" | "review"; reason: string };

/** Rules where an explicit owner declaration is accepted on its own for auto-pass. Everything else needs verified evidence. */
export const DECLARATION_ALLOWED: Partial<Record<RuleKey, boolean>> = { previous_upgrade: true, occupancy: true, life_support: true };

export type Gate1Facts = {
  state: string | null;
  postcode: string | null;
  occupancy: string | null;
  isResidential: boolean | null;
  yearBuilt: number | null;
  yearBuiltVerified: boolean; // verified construction year (hard-fail capable)
  minBuildingAgeYears: number;
  lifeSupportStatus: string | null; // yes | no | unknown | null
  previousCeilingUpgrade: boolean | null;
  flatRoofOrAccessConcern: boolean; // only when explicitly detected/declared
  preliminaryOutcome: string | null; // Base44 info only
  currentYear: number;
  /** Verified minimum age from first-appearance evidence (can pass, never fails). */
  verifiedMinAgeYears?: number | null;
  /** Owner says building is older than the minimum – useful, never verified. */
  declaredOverMinAge?: "yes" | "no" | "unknown" | null;
  /** Residential support that is declaration-only or conflicting -> review message. */
  residentialNote?: string | null;
  evidence?: Partial<Record<RuleKey, FactEvidence>>;
};

export type Gate1Decision = {
  outcome: "likely_eligible" | "does_not_appear_eligible" | null; // null = human review
  passed: string[];
  failed: string[];
  review: string[];
  rules: RuleEvidence[];
};

const VIC_POSTCODE = /^(3\d{3}|8\d{3})$/;

export function evaluateGate1(f: Gate1Facts): Gate1Decision {
  const passed: string[] = [], failed: string[] = [], review: string[] = [], rules: RuleEvidence[] = [];
  const ev = (k: RuleKey, fallback: FactEvidence): FactEvidence => f.evidence?.[k] ?? fallback;
  const rule = (key: RuleKey, label: string, result: RuleEvidence["result"], reason: string, e: FactEvidence) => {
    rules.push({ key, label, result, reason, ...e });
    (result === "pass" ? passed : result === "fail" ? failed : review).push(reason);
  };
  const st = f.state?.trim().toUpperCase() ?? null;
  const pc = f.postcode?.trim() ?? null;

  // Hard, objective rules
  const loc = ev("location", { fact: [st, pc].filter(Boolean).join(" ") || "—", source: "properties", basis: st || pc ? "recorded" : "unknown" });
  if (st && st !== "VIC") rule("location", "Victorian property", "fail", `Property state is ${st} (Victoria only)`, loc);
  else if (pc && !VIC_POSTCODE.test(pc)) rule("location", "Victorian property", "fail", `Postcode ${pc} is not a Victorian postcode`, loc);
  else if (st === "VIC" && pc && VIC_POSTCODE.test(pc)) rule("location", "Victorian property", "pass", "Victorian property (state + postcode)", loc);
  else rule("location", "Victorian property", "review", "Victorian location not confirmed", loc);

  const res = ev("residential", { fact: f.isResidential == null ? "unknown" : String(f.isResidential), source: "properties.is_residential", basis: f.isResidential == null ? "unknown" : "recorded" });
  if (f.isResidential === false) rule("residential", "Residential premises", "fail", "Property recorded as non-residential", res);
  else if (f.isResidential === true) rule("residential", "Residential premises", "pass", "Residential property", res);
  else rule("residential", "Residential premises", "review", f.residentialNote ?? "Residential status unknown", res);

  const min = f.minBuildingAgeYears;
  const age = ev("building_age", { fact: f.yearBuilt ? `built ${f.yearBuilt}` : "unknown", source: "properties.year_built", basis: f.yearBuiltVerified ? "verified" : f.yearBuilt ? "recorded" : "unknown" });
  if (f.yearBuilt != null && f.yearBuiltVerified) {
    const a = f.currentYear - f.yearBuilt;
    if (a < min) rule("building_age", "Building age", "fail", `Building age ${a} years is under the ${min}-year minimum`, age);
    else rule("building_age", "Building age", "pass", `Building age ${a} years (≥ ${min}), verified`, age);
  } else if (f.verifiedMinAgeYears != null && f.verifiedMinAgeYears >= min) {
    rule("building_age", "Building age", "pass", `Building at least ${f.verifiedMinAgeYears} years old (≥ ${min}), verified first-appearance evidence`, age);
  } else if (f.verifiedMinAgeYears != null) {
    rule("building_age", "Building age", "review", `First-appearance evidence only shows ${f.verifiedMinAgeYears} years – confirm age`, age);
  } else if (f.declaredOverMinAge === "yes") {
    rule("building_age", "Building age", "review", "Owner declares building is old enough – not verified", age);
  } else if (f.declaredOverMinAge === "no") {
    rule("building_age", "Building age", "review", "Owner declares building may be too new – verify before deciding", age);
  } else rule("building_age", "Building age", "review", "Building age not verified", age);

  // Review-only conditions (never auto-fail)
  const occ = ev("occupancy", { fact: f.occupancy ?? "unknown", source: "properties.occupancy", basis: f.occupancy ? "declared" : "unknown" });
  if (f.occupancy === "owner_occupied" || f.occupancy === "rental") rule("occupancy", "Occupancy", "pass", `Occupancy recorded (${f.occupancy.replace("_", " ")})`, occ);
  else rule("occupancy", "Occupancy", "review", "Occupancy unknown", occ);

  const ls = ev("life_support", { fact: f.lifeSupportStatus ?? "unknown", source: "jobs.life_support_status", basis: f.lifeSupportStatus && f.lifeSupportStatus !== "unknown" ? "declared" : "unknown" });
  if (f.lifeSupportStatus === "no") rule("life_support", "Life support", "pass", "No life support at property", ls);
  else if (f.lifeSupportStatus === "yes") rule("life_support", "Life support", "review", "Life support at property – process exception", ls);
  else rule("life_support", "Life support", "review", "Life-support status unconfirmed", ls);

  const pu = ev("previous_upgrade", { fact: f.previousCeilingUpgrade == null ? "unknown" : f.previousCeilingUpgrade ? "yes" : "no", source: "properties.enrichment", basis: f.previousCeilingUpgrade == null ? "unknown" : "recorded" });
  if (f.previousCeilingUpgrade === false && (pu.basis !== "declared" || DECLARATION_ALLOWED.previous_upgrade)) rule("previous_upgrade", "Previous ceiling upgrade", "pass", pu.basis === "declared" ? "Owner declares no previous ceiling insulation upgrade" : "No previous ceiling insulation upgrade recorded", pu);
  else if (f.previousCeilingUpgrade === false) rule("previous_upgrade", "Previous ceiling upgrade", "review", "Owner declares no previous upgrade – stronger proof required", pu);
  else if (f.previousCeilingUpgrade === true) rule("previous_upgrade", "Previous ceiling upgrade", "review", "Previous ceiling insulation upgrade recorded – needs review", pu);
  else rule("previous_upgrade", "Previous ceiling upgrade", "review", "Previous upgrade history unclear", pu);

  const ra = ev("roof_access", { fact: f.flatRoofOrAccessConcern ? "concern flagged" : "none detected", source: "properties.enrichment", basis: f.flatRoofOrAccessConcern ? "recorded" : "unknown" });
  if (f.flatRoofOrAccessConcern) rule("roof_access", "Roof / access", "review", "Flat roof / access concern flagged", ra);
  else rules.push({ key: "roof_access", label: "Roof / access", result: "pass", reason: "No flat-roof or access concern explicitly detected (confirmed onsite)", ...ra });

  const out = (o: Gate1Decision["outcome"]) => ({ outcome: o, passed, failed, review, rules });
  if (failed.length) return out("does_not_appear_eligible");
  // Contradiction with the website's preliminary result -> human review.
  if (f.preliminaryOutcome && f.preliminaryOutcome !== "likely_eligible")
    rule("preliminary", "Website preliminary result", "review", `Website preliminary result was ${f.preliminaryOutcome.replace(/_/g, " ")} – conflicts with auto-pass`, { fact: f.preliminaryOutcome, source: "base44", basis: "declared" });
  if (review.length) return out(null);
  return out("likely_eligible");
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

export type StoredProperty = { state: string | null; postcode: string | null; occupancy: string | null; is_residential: boolean | null; year_built: number | null; enrichment: Record<string, unknown> | null };

/** Current Property Intelligence fact as stored in property_facts. */
export type IntelFact = { fact_key: string; value: unknown; evidence_kind: string | null; confidence: string | null; source_type: string | null; source_name: string | null; source_url?: string | null; is_current: boolean; is_stale: boolean };
/** Only direct, high-confidence, current, externally sourced facts may SET a Gate 1 fact. Zoning/inferred facts never do. */
export function trustedIntel(f: IntelFact | undefined): f is IntelFact {
  return !!f && f.is_current && !f.is_stale && f.evidence_kind === "direct" && (f.confidence === "high" || f.confidence === "very_high")
    && ["public_gis", "partner", "provider"].includes(f.source_type ?? "");
}
const intelSrc = (f: IntelFact) => `property intelligence: ${f.source_name ?? f.source_type}${f.source_url ? ` (${f.source_url})` : ""}`;

export function resolveGate1Facts(p: StoredProperty | null, job: { lifeSupportStatus: string | null; preliminaryOutcome: string | null }, minAge: number, currentYear: number, intel: IntelFact[] = []): Gate1Facts {
  const base = resolveBaseFacts(p, job, minAge, currentYear);
  return applyIntelligence(base, intel, currentYear);
}

/** Property Intelligence feeds Gate 1 only where the portal/Base44 left a fact unknown AND the evidence is trusted. */
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
  const ncc = get("ncc_class_evidence");
  if (out.isResidential == null && !out.residentialNote && trustedIntel(ncc)) {
    if (ncc.value === "class1" || ncc.value === "class2_sou") { out.isResidential = true; ev.residential = { fact: `NCC ${ncc.value}`, source: intelSrc(ncc), basis: "verified" }; }
    else if (ncc.value === "not_eligible") { out.isResidential = false; ev.residential = { fact: "not Class 1 / Class 2 SOU", source: intelSrc(ncc), basis: "verified" }; }
  }
  const age = get("age_evidence");
  if (out.yearBuilt == null && out.verifiedMinAgeYears == null && trustedIntel(age)) {
    const v = age.value as { date?: string | null; kind?: string } | null;
    const yr = v?.date ? new Date(v.date).getFullYear() : null;
    if (yr && (v?.kind === "historical_imagery_same_footprint" || v?.kind === "direct_record")) {
      if (v.kind === "direct_record") { out.yearBuilt = yr; out.yearBuiltVerified = true; }
      else out.verifiedMinAgeYears = currentYear - yr;
      ev.building_age = { fact: `${v.kind === "direct_record" ? "built" : "first appears"} ${yr}`, source: intelSrc(age), basis: "verified" };
    }
  }
  // Review-only flags may come from any current fact (raising review is always safe).
  const roof = get("roof_form"), storey = get("another_storey_above_relevant_ceiling");
  const roofFlag = roof?.value === "low_slope_flat" || roof?.value === "mixed", storeyFlag = storey?.value === "yes";
  if (!out.flatRoofOrAccessConcern && (roofFlag || storeyFlag)) {
    out.flatRoofOrAccessConcern = true;
    ev.roof_access = { fact: roofFlag ? `roof form ${roof!.value}` : "storey above relevant ceiling", source: intelSrc((roofFlag ? roof : storey)!), basis: trustedIntel(roofFlag ? roof : storey) ? "verified" : "recorded" };
  }
  return out;
}

function resolveBaseFacts(p: StoredProperty | null, job: { lifeSupportStatus: string | null; preliminaryOutcome: string | null }, minAge: number, currentYear: number): Gate1Facts {
  const e = (p?.enrichment ?? {}) as Record<string, unknown>;
  const b = (e["base44"] ?? {}) as { declared?: Record<string, unknown>; research?: Record<string, unknown> };
  const d = b.declared ?? {}, r = b.research ?? {};
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

  // Building age
  const yearBuiltVerified = e["year_built_verified"] === true;
  const fa = typeof r["first_appearance_year"] === "number" ? (r["first_appearance_year"] as number) : null;
  const verifiedMinAgeYears = researchDone && r["age_verified"] === true && fa ? currentYear - fa : null;
  const declaredOverMinAge = (["yes", "no", "unknown"].includes(d["over_five_years"] as string) ? d["over_five_years"] : null) as "yes" | "no" | "unknown" | null;
  if (p?.year_built) evidence.building_age = { fact: `built ${p.year_built}`, source: "properties.year_built", basis: yearBuiltVerified ? "verified" : "recorded" };
  else if (verifiedMinAgeYears != null) evidence.building_age = { fact: `first appears ${fa}${r["age_evidence_source"] ? ` (${r["age_evidence_source"]})` : ""}`, source: "base44.property_research", basis: "verified" };
  else if (declaredOverMinAge) evidence.building_age = { fact: `owner: over 5 years = ${declaredOverMinAge}`, source: "base44 owner declaration", basis: "declared" };

  // Previous upgrade: recorded enrichment value, else owner declaration.
  let previousCeilingUpgrade: boolean | null = typeof e["previous_ceiling_insulation_upgrade"] === "boolean" ? (e["previous_ceiling_insulation_upgrade"] as boolean) : null;
  if (previousCeilingUpgrade != null) evidence.previous_upgrade = { fact: previousCeilingUpgrade ? "yes" : "no", source: "properties.enrichment", basis: "recorded" };
  else if (d["previous_upgrade"] === "yes" || d["previous_upgrade"] === "no") {
    previousCeilingUpgrade = d["previous_upgrade"] === "yes";
    evidence.previous_upgrade = { fact: `owner: ${d["previous_upgrade"]}`, source: "base44 owner declaration", basis: "declared" };
  }

  const detectedFlat = r["flat_roof_detected"] === true || r["access_concern_detected"] === true;
  const flat = e["flat_roof"] === true || e["access_concern"] === true || detectedFlat;
  if (flat) evidence.roof_access = { fact: "flat roof / access concern", source: detectedFlat ? "base44.property_research" : "properties.enrichment", basis: detectedFlat ? "verified" : "recorded" };

  return {
    state, postcode, occupancy: p?.occupancy ?? null, isResidential, yearBuilt: p?.year_built ?? null, yearBuiltVerified,
    minBuildingAgeYears: minAge, lifeSupportStatus: job.lifeSupportStatus, previousCeilingUpgrade, flatRoofOrAccessConcern: flat,
    preliminaryOutcome: job.preliminaryOutcome, currentYear, verifiedMinAgeYears, declaredOverMinAge, residentialNote, evidence,
  };
}
