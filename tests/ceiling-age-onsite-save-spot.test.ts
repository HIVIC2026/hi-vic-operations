import { expect, test } from "bun:test";
import { insulationOnly, firstResponseOutcome, automaticLeadEmail, classifyEnquiry } from "../src/lib/enquiry-groups.core";
import { launchGroup } from "../src/lib/launch-campaign.core";
import { declarationCriteriaPassed } from "../src/lib/insulation-review.core";
import { GATE1_RULESET_VERSION } from "../src/lib/eligibility.core";
const audit = (age: string) => ({ ruleset_version: GATE1_RULESET_VERSION, rules: [
  { key: "location", result: "pass" }, { key: "residential", result: "pass" }, { key: "ceiling_age", result: age },
  { key: "previous_activity", result: "pass" }, { key: "roof_access", result: "pass" }, { key: "existing_insulation", result: "onsite" },
] }) as never;
const x = (age: string) => ({ outcome: "needs_onsite_confirmation", decisionSource: "system", reviewRequired: false, audit: audit(age), insulation: "present" as const, intakeActive: false });
test("house age unknown (onsite) does not block Save my spot", () => {
  expect(insulationOnly(audit("onsite"), "present").ok).toBe(true);
  expect(declarationCriteriaPassed(x("onsite"))).toBe(true);
});
test("built in the last 5 years (fail) still blocks", () => expect(declarationCriteriaPassed(x("fail"))).toBe(false));

const noInsulationAudit = (age: string) => ({ ...audit(age), rules: audit(age).rules.map(r => r.key === "existing_insulation" ? { ...r, result: "pass" } : r) });
const route = (age: string) => ({ source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, outcome: "needs_onsite_confirmation", intakeWorkActive: false, declaredInsulation: "none" as const, ownerEnteredArea: true, audit: noInsulationAudit(age) });
test("unknown age with no insulation qualifies every first-response path without changing Gate 1", () => {
  const facts = route("onsite");
  expect(firstResponseOutcome(facts.outcome, "none", facts.audit)).toBe("likely_eligible");
  expect(automaticLeadEmail(facts)).toEqual({ email: "offer_spot", blocker: null });
  expect(launchGroup(facts.outcome, "none", facts.audit)).toBe("likely");
  expect(classifyEnquiry({ kind: "job", stage: "new_enquiry", outcome: facts.outcome, decisionSource: "system", reviewRequired: false, audit: facts.audit, intakeWorkActive: false, area: { declared: 120 }, videoCount: 0, declaredInsulation: "none" }).group).toBe("likely_size");
  expect(facts.outcome).toBe("needs_onsite_confirmation");
});
test("failed five-year age gate still blocks no-insulation first responses", () => {
  const facts = route("fail");
  expect(firstResponseOutcome(facts.outcome, "none", facts.audit)).toBe("needs_onsite_confirmation");
  expect(automaticLeadEmail(facts).email).toBe("none");
  expect(launchGroup(facts.outcome, "none", facts.audit)).toBeNull();
});
test("unknown age does not waive other failed or missing gates", () => {
  const facts = route("onsite");
  for (const key of ["location", "residential", "previous_activity", "roof_access"]) {
    const failed = { ...facts.audit, rules: facts.audit.rules.map(r => r.key === key ? { ...r, result: "fail" } : r) };
    expect(automaticLeadEmail({ ...facts, audit: failed }).email).toBe("none");
    const missing = { ...facts.audit, rules: facts.audit.rules.filter(r => r.key !== key) };
    expect(automaticLeadEmail({ ...facts, audit: missing }).email).toBe("none");
  }
});
