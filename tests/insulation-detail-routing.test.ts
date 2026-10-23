import { describe, expect, test } from "bun:test";
import { declaredInsulationDetail, insulationDetailRoute, insulationDetailText } from "../src/lib/enquiry.core";
import { automaticLeadEmail } from "../src/lib/enquiry-groups.core";
import { enquirySchema } from "../src/lib/enquiry.server";
import { ownerAnswerForGate1 } from "../src/lib/portal-presentation.core";

const base = { source: "base44", channel: "hivic_sourced", decisionSource: "system", reviewRequired: false, outcome: "needs_onsite_confirmation", intakeWorkActive: false, declaredInsulation: "present" as const, ownerEnteredArea: true };
const route = (a: Record<string, unknown>) => automaticLeadEmail({ ...base, insulationDetailRoute: insulationDetailRoute(declaredInsulationDetail(a)) });

describe("Jo 22 Oct insulation answers routing", () => {
  test("thin → Save my spot offer, never the 'tell us about your insulation' email", () => {
    expect(route({ insulation_type: "loose_fill", insulation_thickness: "thin", insulation_coverage: "whole" })).toEqual({ email: "offer_spot", blocker: null, existingInsulation: true });
  });
  test("partial coverage → Save my spot offer even when hand thick", () => {
    expect(route({ insulation_type: "batts", insulation_thickness: "hand", insulation_coverage: "partial" }).email).toBe("offer_spot");
  });
  test("thin/patchy with no owner size keeps the typical-size hold flag", () => {
    const r = automaticLeadEmail({ ...base, ownerEnteredArea: false, insulationDetailRoute: insulationDetailRoute({ insulation_type: "foil", insulation_thickness: "thin", insulation_coverage: "whole" }) });
    expect(r).toEqual({ email: "offer_spot", blocker: null, existingInsulation: true, assumedArea: true });
  });
  test("hand thick, whole ceiling → existing-insulation offer (Jo 23 Oct)", () => {
    expect(route({ insulation_type: "loose_fill", insulation_thickness: "hand", insulation_coverage: "whole" }).email).toBe("offer_spot");
  });
  test("thicker, whole ceiling → existing-insulation offer (Jo 23 Oct)", () => {
    expect(route({ insulation_type: "batts", insulation_thickness: "thicker", insulation_coverage: "whole" }).email).toBe("offer_spot");
  });
  test("missing or unknown answers → existing-insulation offer (Jo 23 Oct)", () => {
    expect(route({}).email).toBe("offer_spot");
    expect(route({ insulation_type: "loose_fill", insulation_thickness: "unknown", insulation_coverage: "partial" }).email).toBe("offer_spot");
    expect(route({ insulation_type: "unknown", insulation_thickness: "thin", insulation_coverage: "whole" }).email).toBe("offer_spot");
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
    const shape = enquirySchema.shape.base44_answers;
    const r = shape.safeParse({ insulation: "present", insulation_type: "loose_fill", insulation_thickness: "thin", insulation_coverage: "partial" });
    expect(r.success).toBe(true);
    expect(r.data).toEqual({ insulation: "present", insulation_type: "loose_fill", insulation_thickness: "thin", insulation_coverage: "partial" });
  });
  test("office sees 'Owner says: loose fill, thin, patchy'", () => {
    const d = { existing_insulation: "present", ...declaredInsulationDetail({ insulation_type: "loose_fill", insulation_thickness: "thin", insulation_coverage: "partial" }) };
    expect(insulationDetailText(d)).toBe("loose fill, thin, patchy");
    expect(ownerAnswerForGate1("existing_insulation", { declaredExtras: d })).toBe("Owner says insulation is present — Owner says: loose fill, thin, patchy");
  });
  test("unexpected values are ignored", () => {
    expect(declaredInsulationDetail({ insulation_thickness: "huge" }).insulation_thickness).toBeNull();
  });
});
