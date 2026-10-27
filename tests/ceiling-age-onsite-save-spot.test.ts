import { expect, test } from "bun:test";
import { insulationOnly } from "../src/lib/enquiry-groups.core";
import { declarationCriteriaPassed } from "../src/lib/insulation-review.core";
import { GATE1_RULESET_VERSION } from "../src/lib/gate1.core";
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
