// Pure facts for the TEST Group B homeowner: existing insulation declared, every other initial check passed,
// existing-insulation check open (onsite), and an explicitly complete EMPTY original-media manifest.
export function groupBTestRaw() {
  return {
    answers: { insulation: "yes", media: [], property_type: "house", property_over_five_years: "yes", life_support_present: "no", previous_upgrade: "no", state: "VIC", postcode: "3000" },
    original_media_verification: { complete: true, source: "TEST fixture" },
  };
}
export function groupBTestAudit(rulesetVersion: string) {
  const rule = (key: string, result: string) => ({ key, result, reason: "TEST fixture" });
  return {
    ruleset_version: rulesetVersion, hard_failures: [], review_reasons: [],
    rules: [rule("location", "pass"), rule("residential", "pass"), rule("ceiling_age", "pass"), rule("previous_activity", "pass"), rule("existing_insulation", "onsite"), rule("roof_access", "info"), rule("life_support", "info"), rule("area", "info")],
  };
}
