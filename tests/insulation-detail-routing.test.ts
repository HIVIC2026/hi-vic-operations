import { describe, expect, test } from "bun:test";
import { declaredExtras, insulationDetailRoute, insulationDetailText } from "../src/lib/enquiry.core";
import { automaticLeadEmail, DECLARED_THIN_SAVE_SPOT_HELD } from "../src/lib/enquiry-groups.core";
import { enquirySchema } from "../src/lib/enquiry.server";
import { ownerAnswerForGate1 } from "../src/lib/portal-presentation.core";

const base = { source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, outcome: "needs_onsite_confirmation", intakeWorkActive: false, declaredInsulation: "present" as const, ownerEnteredArea: true };
const route = (a: Record<string, unknown>) => automaticLeadEmail({ ...base, insulationDetailRoute: insulationDetailRoute(declaredExtras({ insulation: "present", ...a })) });

describe("Jo 22 Oct insulation answers routing", () => {
  test("thin → no 'tell us about your insulation' email (held for Save My Spot)", () => {
    expect(route({ insulation_type: "loose_fill", insulation_thickness: "thin", insulation_coverage: "whole" })).toEqual({ email: "none", blocker: DECLARED_THIN_SAVE_SPOT_HELD });
  });
  test("partial coverage → held for Save My Spot even when hand thick", () => {
    expect(route({ insulation_type: "batts", insulation_thickness: "hand", insulation_coverage: "partial" }).email).toBe("none");
  });
  test("hand thick, whole ceiling → existing photo request", () => {
    expect(route({ insulation_type: "loose_fill", insulation_thickness: "hand", insulation_coverage: "whole" }).email).toBe("request_insulation");
  });
  test("thicker, whole ceiling → existing photo request", () => {
    expect(route({ insulation_type: "batts", insulation_thickness: "thicker", insulation_coverage: "whole" }).email).toBe("request_insulation");
  });
  test("missing or unknown answers → current behaviour", () => {
    expect(route({}).email).toBe("request_insulation");
    expect(route({ insulation_type: "loose_fill", insulation_thickness: "unknown", insulation_coverage: "partial" }).email).toBe("request_insulation");
    expect(route({ insulation_type: "unknown", insulation_thickness: "thin", insulation_coverage: "whole" }).email).toBe("request_insulation");
  });
  test("existing safeguards still win (TEST, review, ineligible)", () => {
    const thin = insulationDetailRoute({ insulation_type: "foil", insulation_thickness: "thin", insulation_coverage: "whole" });
    expect(automaticLeadEmail({ ...base, source: "qa_test", insulationDetailRoute: thin }).blocker).toBe("TEST enquiry");
    expect(automaticLeadEmail({ ...base, reviewRequired: true, insulationDetailRoute: thin }).email).toBe("none");
    expect(automaticLeadEmail({ ...base, outcome: "does_not_appear_eligible", insulationDetailRoute: thin }).email).toBe("ineligible");
  });
  test("owner said none is unaffected", () => {
    expect(automaticLeadEmail({ ...base, outcome: "likely_eligible", declaredInsulation: "none", insulationDetailRoute: null }).email).toBe("offer_spot");
  });
});

describe("intake and display", () => {
  test("intake accepts the three new answers inside base44_answers", () => {
    const r = enquirySchema.safeParse({ full_name: "A", email: "a@b.com", base44_answers: { insulation: "present", insulation_type: "loose_fill", insulation_thickness: "thin", insulation_coverage: "partial" } });
    expect(r.success).toBe(true);
  });
  test("office sees 'Owner says: loose fill, thin, patchy'", () => {
    const d = declaredExtras({ insulation: "present", insulation_type: "loose_fill", insulation_thickness: "thin", insulation_coverage: "partial" });
    expect(insulationDetailText(d)).toBe("loose fill, thin, patchy");
    expect(ownerAnswerForGate1("existing_insulation", { declaredExtras: d })).toBe("Owner says insulation is present — Owner says: loose fill, thin, patchy");
  });
  test("unexpected values are ignored", () => {
    expect(declaredExtras({ insulation_thickness: "huge" }).insulation_thickness).toBeNull();
  });
});
