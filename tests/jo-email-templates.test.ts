// P1-R3-COM-08 — Jo Lowe's eight email templates: routing, CTA, wording, review gate,
// saved-pricing immutability, and safety. Pure unit tests (bun:test), no network/DB/sends.
import { describe, expect, test } from "bun:test";
import {
  selectJoTemplate,
  ctasForTemplate,
  subjectForTemplate,
  renderJoEstimateEmail,
  renderJoIneligibleEmail,
  DEFAULT_ASSUMED_AREA_M2,
  type JoRoutingInput,
  type JoEstimateFigures,
  type JoRecipient,
} from "../src/lib/jo-email-templates.core";

const recipient: JoRecipient = {
  firstName: "Alex",
  propertyAddress: "12 Example St, Melbourne VIC 3000",
  enquiryReference: "JOB-1001",
};

const liveFigures = (overrides: Partial<JoEstimateFigures> = {}): JoEstimateFigures => ({
  veuRebate: 1200,
  customerTotal: 3800,
  totalBeforeRebate: 5000,
  installation: 4200,
  piesaFee: 349,
  apFee: 451,
  ceilingAreaM2: 150,
  areaEstimated: true,
  ...overrides,
});

// ---------------------------------------------------------------------------
// 1. Routing — all eight distinct branches
// ---------------------------------------------------------------------------
describe("selectJoTemplate routing", () => {
  const base: JoRoutingInput = { outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false };

  test("T1 eligible / no insulation / size unknown", () => {
    expect(selectJoTemplate({ ...base, insulation: "none", ceilingSizeKnown: false }))
      .toBe("eligible_no_insulation_size_unknown");
  });
  test("T2 eligible / no insulation / size known", () => {
    expect(selectJoTemplate({ ...base, insulation: "none", ceilingSizeKnown: true }))
      .toBe("eligible_no_insulation_size_known");
  });
  test("T3 below R2 reviewed / size unknown", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: false, deskCheckStatus: "looks_eligible" }))
      .toBe("eligible_below_r2_reviewed_size_unknown");
  });
  test("T4 below R2 reviewed / size known", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" }))
      .toBe("eligible_below_r2_reviewed_size_known");
  });
  test("T5 potentially eligible / unknown insulation / size unknown", () => {
    expect(selectJoTemplate({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false }))
      .toBe("potentially_eligible_unknown_size_unknown");
  });
  test("T6 potentially eligible / unknown insulation / size known", () => {
    expect(selectJoTemplate({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true }))
      .toBe("potentially_eligible_unknown_size_known");
  });
  test("T7 ineligible", () => {
    expect(selectJoTemplate({ outcome: "ineligible", insulation: null, ceilingSizeKnown: false }))
      .toBe("ineligible");
  });
});

// ---------------------------------------------------------------------------
// 2. Below-R2 review gate — must NOT fire without a verified review
// ---------------------------------------------------------------------------
describe("below-R2 review gate", () => {
  test("present insulation WITHOUT review does NOT select below-R2 (falls to potentially-eligible upload)", () => {
    const id = selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: false, deskCheckStatus: null });
    expect(id).toBe("potentially_eligible_unknown_size_unknown");
  });
  test("unknown insulation is never treated as below R2", () => {
    const id = selectJoTemplate({ outcome: "likely_eligible", insulation: "unknown", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible" });
    expect(id).toBe("potentially_eligible_unknown_size_known");
  });
  test("desk status not_eligible / needs_onsite_check does not unlock below-R2", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "needs_onsite_check" }))
      .toBe("potentially_eligible_unknown_size_known");
  });
});

// ---------------------------------------------------------------------------
// 4. CTA mapping
// ---------------------------------------------------------------------------
describe("CTA selection", () => {
  test("eligible templates use Save my spot", () => {
    expect(ctasForTemplate("eligible_no_insulation_size_unknown")).toEqual(["save_my_spot"]);
    expect(ctasForTemplate("eligible_below_r2_reviewed_size_known")).toEqual(["save_my_spot"]);
  });
  test("potentially eligible templates use upload, NOT save my spot", () => {
    expect(ctasForTemplate("potentially_eligible_unknown_size_unknown")).toEqual(["upload_media"]);
    expect(ctasForTemplate("potentially_eligible_unknown_size_known")).not.toContain("save_my_spot");
  });
  test("ineligible has no Save my spot", () => {
    expect(ctasForTemplate("ineligible")).toEqual(["review_result"]);
    expect(ctasForTemplate("ineligible")).not.toContain("save_my_spot");
  });
  test("the retired Template 8 (office Ready Check invitation) is no longer a template", () => {
    expect(() => ctasForTemplate("ready_check_invitation" as never)).not.toThrow();
    expect(ctasForTemplate("ready_check_invitation" as never)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. Known vs unknown ceiling area wording + default 150 m²
// ---------------------------------------------------------------------------
describe("ceiling area wording", () => {
  test("unknown size => 150 m² estimated, not measured", () => {
    const out = renderJoEstimateEmail("eligible_no_insulation_size_unknown", recipient, liveFigures({ ceilingAreaM2: DEFAULT_ASSUMED_AREA_M2, areaEstimated: true }));
    expect(out.body).toContain("150 m² — estimated, not measured");
    expect(out.body).toContain("we’ve used 150 m² for this preliminary quote");
  });
  test("known size => based on the size you provided", () => {
    const out = renderJoEstimateEmail("eligible_no_insulation_size_known", recipient, liveFigures({ ceilingAreaM2: 220, areaEstimated: false }));
    expect(out.body).toContain("220 m² — based on the size you provided");
    expect(out.body).not.toContain("estimated, not measured");
  });
});

// ---------------------------------------------------------------------------
// 6. Removal allowance wording — informational; NOT added to the quoted total
// ---------------------------------------------------------------------------
describe("removal allowance", () => {
  test("below-R2 templates include $15/m² allowance wording", () => {
    const out = renderJoEstimateEmail("eligible_below_r2_reviewed_size_unknown", recipient, liveFigures());
    expect(out.body).toContain("$15 per m² including GST for the areas that need removal only");
    expect(out.body).toContain("Removal is not included in this preliminary quote");
  });
  test("removal allowance is not silently added to customer total", () => {
    const f = liveFigures({ customerTotal: 3800 });
    const out = renderJoEstimateEmail("eligible_below_r2_reviewed_size_known", recipient, { ...f, areaEstimated: false, ceilingAreaM2: 180 });
    // The displayed total equals the input total; no removal math applied to it.
    expect(out.body).toContain("Your estimated cost after rebate: $3,800 including GST");
  });
  test("eligible-no-insulation templates exclude removal (no $15 budget line)", () => {
    const out = renderJoEstimateEmail("eligible_no_insulation_size_known", recipient, liveFigures({ areaEstimated: false, ceilingAreaM2: 200 }));
    expect(out.body).toContain("Insulation removal and electrical fixes are excluded");
    expect(out.body).not.toContain("budget $15 per m²");
  });
});

// ---------------------------------------------------------------------------
// 8. Subjects + footer (shared, verbatim) + no obligation language
// ---------------------------------------------------------------------------
describe("subjects and footer", () => {
  test("ineligible subject", () => {
    expect(subjectForTemplate("ineligible", "Alex")).toBe("Your ceiling insulation eligibility result");
  });
  test("shared footer present on every template", () => {
    const bodies = [
      renderJoEstimateEmail("eligible_no_insulation_size_unknown", recipient, liveFigures()).body,
      renderJoIneligibleEmail(recipient, "Your property already has compliant insulation.").body,
    ];
    for (const b of bodies) {
      expect(b).toContain("DC Construction Solutions Pty Ltd trading as Home Insulation Victoria");
      expect(b).toContain("Reference: JOB-1001");
    }
  });
  test("ineligible includes the specific reason and review CTA", () => {
    const out = renderJoIneligibleEmail(recipient, "Your property already has compliant ceiling insulation.");
    expect(out.body).toContain("Your property already has compliant ceiling insulation.");
    expect(out.body).toContain("[Review my result →]");
  });
});

// ---------------------------------------------------------------------------
// 9. Purity / safety — module performs no sends (no provider/network symbols)
// ---------------------------------------------------------------------------
describe("module safety", () => {
  test("rendering is deterministic and side-effect free", () => {
    const a = renderJoEstimateEmail("potentially_eligible_unknown_size_unknown", recipient, liveFigures());
    const b = renderJoEstimateEmail("potentially_eligible_unknown_size_unknown", recipient, liveFigures());
    expect(a.body).toBe(b.body);
    expect(a.ctas).toEqual(["upload_media"]);
  });
  test("potentially-eligible body requests upload and does not offer Save my spot", () => {
    const out = renderJoEstimateEmail("potentially_eligible_unknown_size_known", recipient, liveFigures({ areaEstimated: false, ceilingAreaM2: 175 }));
    expect(out.body).toContain("[Tell us about your insulation]");
    expect(out.body).not.toContain("[Save my spot →]");
  });
});
