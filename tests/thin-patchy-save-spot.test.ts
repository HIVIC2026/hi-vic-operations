import { describe, expect, test } from "bun:test";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";
import { selectJoTemplate } from "../src/lib/jo-email-templates.core";

const T = "A".repeat(43);
const base = `${"https://estimate.homeinsulationvictoria.com.au/estimate"}/${T}`;
const input = {
  outcome: "likely_eligible" as const,
  insulation: "present" as const,
  ceilingSizeKnown: true,
  declaredThinPatchy: true,
  recipient: { firstName: "Sam", propertyAddress: "30 Dash St, Fraser Rise VIC 3336", enquiryReference: "HV-1" },
  figures: { veuRebate: 1050, customerTotal: 2948, totalBeforeRebate: 3998, installation: 3300, piesaFee: 349, apFee: 349, ceilingAreaM2: 110, areaEstimated: false, removalUpTo: 1650 },
  links: { saveMySpotUrl: `${base}/campaign`, uploadMediaUrl: `${base}/video`, reviewResultUrl: base, calculatorUrl: `${base}/calculator` },
};

describe("Jo 22 Oct thin/patchy Save my spot (decision 67 design since 24 Oct)", () => {
  test("selector sends declared thin/patchy to the eligible Save my spot templates", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, declaredThinPatchy: true })).toBe("eligible_no_insulation_size_known");
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: false, declaredThinPatchy: true })).toBe("eligible_no_insulation_size_unknown");
  });
  test("unreviewed present insulation without the flag is unchanged (photo request)", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true })).toBe("potentially_eligible_unknown_size_known");
  });
  test("the some-insulation design: 'may qualify', the existing-insulation card, never the forbidden claims", () => {
    const e = renderJoOutcomeEmail(input);
    expect(e).not.toBeNull();
    expect(e!.templateId).toBe("eligible_no_insulation_size_known");
    expect(e!.ctas).toContain("save_my_spot");
    expect(e!.plainText).toContain("Sam, you may qualify for $1,050 off ceiling insulation");
    expect(e!.plainText).toContain("You told us there's some insulation in your ceiling already.");
    expect(e!.plainText).not.toContain("no existing insulation");
    expect(e!.plainText).not.toContain("reviewed them");
    expect(e!.plainText).not.toContain("photos or video");
    // The "up to" removal allowance is shown separately (the card) and never added to the price.
    expect(e!.plainText).toContain("Up to $1,650 for your 110 m² ceiling.");
    expect(e!.plainText).toContain("$15/m²");
    expect(e!.plainText).toContain("Your cost if eligible: $2,948 incl. GST");
    expect(e!.html).toContain("Save my free spot");
  });
  test("no-insulation owners get the no-insulation design", () => {
    const e = renderJoOutcomeEmail({ ...input, insulation: "none", declaredThinPatchy: false, figures: { ...input.figures, removalUpTo: null } });
    expect(e!.plainText).toContain("Sam, you could save $1,050 on ceiling insulation");
    expect(e!.plainText).toContain("Based on what you told us: 110 m² ceiling, no existing insulation.");
    expect(e!.plainText).not.toContain("may qualify");
    expect(e!.plainText).not.toContain("If some needs removing");
  });
});
