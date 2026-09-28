// Pure, deterministic Gate 1 auto-decision. Risk-based: auto PASS only when every required fact is clearly
// satisfied from recorded data; auto FAIL only on an objective hard rule; everything else -> human review.
// Base44 preliminary screening is never sufficient on its own.
export type Gate1Facts = {
  state: string | null;
  postcode: string | null;
  occupancy: string | null;
  isResidential: boolean | null;
  yearBuilt: number | null;
  yearBuiltVerified: boolean; // enrichment.year_built_verified === true
  minBuildingAgeYears: number;
  lifeSupportStatus: string | null; // yes | no | unknown | null
  previousCeilingUpgrade: boolean | null; // enrichment.previous_ceiling_insulation_upgrade
  flatRoofOrAccessConcern: boolean; // enrichment.flat_roof / access_concern flagged true
  preliminaryOutcome: string | null; // Base44 info only
  currentYear: number;
};

export type Gate1Decision = {
  outcome: "likely_eligible" | "does_not_appear_eligible" | null; // null = human review
  passed: string[];
  failed: string[];
  review: string[];
};

const VIC_POSTCODE = /^(3\d{3}|8\d{3})$/;

export function evaluateGate1(f: Gate1Facts): Gate1Decision {
  const passed: string[] = [], failed: string[] = [], review: string[] = [];
  const st = f.state?.trim().toUpperCase() ?? null;
  const pc = f.postcode?.trim() ?? null;

  // Hard, objective rules
  if (st && st !== "VIC") failed.push(`Property state is ${st} (Victoria only)`);
  else if (pc && !VIC_POSTCODE.test(pc)) failed.push(`Postcode ${pc} is not a Victorian postcode`);
  else if (st === "VIC" && pc && VIC_POSTCODE.test(pc)) passed.push("Victorian property (state + postcode)");
  else review.push("Victorian location not confirmed");

  if (f.isResidential === false) failed.push("Property recorded as non-residential");
  else if (f.isResidential === true) passed.push("Residential property");
  else review.push("Residential status unknown");

  if (f.yearBuilt != null && f.yearBuiltVerified) {
    const age = f.currentYear - f.yearBuilt;
    if (age < f.minBuildingAgeYears) failed.push(`Building age ${age} years is under the ${f.minBuildingAgeYears}-year minimum`);
    else passed.push(`Building age ${age} years (≥ ${f.minBuildingAgeYears}), verified`);
  } else review.push("Building age not verified");

  // Review-only conditions (never auto-fail)
  if (f.occupancy === "owner_occupied" || f.occupancy === "rental") passed.push(`Occupancy recorded (${f.occupancy.replace("_", " ")})`);
  else review.push("Occupancy unknown");
  if (f.lifeSupportStatus === "no") passed.push("No life support at property");
  else if (f.lifeSupportStatus === "yes") review.push("Life support at property – process exception");
  else review.push("Life-support status unconfirmed");
  if (f.previousCeilingUpgrade === false) passed.push("No previous ceiling insulation upgrade recorded");
  else if (f.previousCeilingUpgrade === true) review.push("Previous ceiling insulation upgrade recorded – needs review");
  else review.push("Previous upgrade history unclear");
  if (f.flatRoofOrAccessConcern) review.push("Flat roof / access concern flagged");

  if (failed.length) return { outcome: "does_not_appear_eligible", passed, failed, review };
  // Contradiction with the website's preliminary result -> human review.
  if (f.preliminaryOutcome && f.preliminaryOutcome !== "likely_eligible") review.push(`Website preliminary result was ${f.preliminaryOutcome.replace(/_/g, " ")} – conflicts with auto-pass`);
  if (review.length) return { outcome: null, passed, failed, review };
  return { outcome: "likely_eligible", passed, failed, review };
}
