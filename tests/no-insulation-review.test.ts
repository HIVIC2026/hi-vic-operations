import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { automaticLeadEmail, classifyEnquiry, effectiveInsulation, noInsulationReviewBlocker, MEDIA_OUTCOME_LABEL } from "../src/lib/enquiry-groups.core";

const base = { source: "base44", channel: "hivic_sourced", decisionSource: "admin", reviewRequired: false, outcome: "likely_eligible", intakeWorkActive: false, ownerEnteredArea: true };

describe("Office 'No insulation visible' review", () => {
  test("only latest no_insulation review overrides effective insulation; raw answer otherwise kept", () => {
    expect(effectiveInsulation("present", "no_insulation")).toBe("none");
    expect(effectiveInsulation("unknown", "no_insulation")).toBe("none");
    expect(effectiveInsulation("present", "below_r2")).toBe("present");
    expect(effectiveInsulation("present", null)).toBe("present");
    expect(effectiveInsulation("unknown", "unclear")).toBe("unknown");
  });
  test("no_insulation routes to offer_spot (T2 with owner size), never request_insulation", () => {
    const r = automaticLeadEmail({ ...base, declaredInsulation: effectiveInsulation("present", "no_insulation") });
    expect(r.email).toBe("offer_spot");
    expect(r.assumedArea).toBeUndefined();
  });
  test("unreviewed present/unknown stays request_insulation (T5/T6)", () => {
    expect(automaticLeadEmail({ ...base, declaredInsulation: effectiveInsulation("present", null) }).email).toBe("request_insulation");
    expect(automaticLeadEmail({ ...base, declaredInsulation: effectiveInsulation("unknown", null) }).email).toBe("request_insulation");
  });
  test("grouping places reviewed job in Save my spot lane, not insulation check", () => {
    const c = classifyEnquiry({ kind: "job", stage: "preliminary_estimate_ready", holdReason: null, outcome: "needs_onsite_confirmation", decisionSource: "system", reviewRequired: false, audit: null, intakeWorkActive: false, declaredInsulation: "present", officeInsulation: "no_insulation" } as never);
    expect(c.group === "likely_size" || c.group === "likely_no_size").toBe(true);
  });
  test("blocker refuses TEST, later stages and officially ineligible", () => {
    const ok = { source: "base44", stage: "preliminary_estimate_ready", eligibility_outcome: "needs_onsite_confirmation", eligibility_decision_source: "system" };
    expect(noInsulationReviewBlocker(ok)).toBeNull();
    expect(noInsulationReviewBlocker({ ...ok, source: "qa_test" })).not.toBeNull();
    expect(noInsulationReviewBlocker({ ...ok, stage: "ready_check_booked" })).not.toBeNull();
    expect(noInsulationReviewBlocker({ ...ok, eligibility_outcome: "does_not_appear_eligible" })).not.toBeNull();
    expect(MEDIA_OUTCOME_LABEL.no_insulation).toBe("No insulation visible");
  });
  test("raw homeowner answer is never written; actions admin-only; send uses normal guarded sender", () => {
    const srv = readFileSync("src/lib/enquiry-groups.server.ts", "utf8");
    const fn = readFileSync("src/lib/enquiry-groups.functions.ts", "utf8");
    expect(srv).not.toMatch(/enrichment[^\n]*update|update\([^)]*enrichment/);
    expect(srv).toContain('sendSaveMySpot([jobId], by');
    expect(srv).not.toMatch(/force/i);
    for (const name of ["reviewLeadMediaFn", "noInsulationSaveSpotFn"]) {
      const block = fn.slice(fn.indexOf(`export const ${name}`)).split("export const")[1];
      expect(block).toContain("requireSupabaseAuth");
      expect(block).toContain("requireAdmin(context.supabase)");
    }
  });
});
