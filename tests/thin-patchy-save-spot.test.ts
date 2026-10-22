import { describe, expect, test } from "bun:test";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";
import { THIN_PATCHY_SAVE_SPOT_LINE, selectJoTemplate } from "../src/lib/jo-email-templates.core";
import { REMOVAL_UPTO_NOTE } from "../src/lib/estimate-removal-upto.core";

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

describe("Jo 22 Oct thin/patchy Save my spot wording", () => {
  test("selector sends declared thin/patchy to the eligible Save my spot templates", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, declaredThinPatchy: true })).toBe("eligible_no_insulation_size_known");
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: false, declaredThinPatchy: true })).toBe("eligible_no_insulation_size_unknown");
  });
  test("unreviewed present insulation without the flag is unchanged (photo request)", () => {
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true })).toBe("potentially_eligible_unknown_size_known");
  });
  test("exact approved wording, and never the forbidden claims", () => {
    const e = renderJoOutcomeEmail(input);
    expect(e).not.toBeNull();
    expect(e!.templateId).toBe("eligible_no_insulation_size_known");
    expect(e!.ctas).toContain("save_my_spot");
    expect(e!.plainText).toContain(THIN_PATCHY_SAVE_SPOT_LINE);
    expect(e!.plainText).not.toContain("assumes there is no existing ceiling insulation");
    expect(e!.plainText).not.toContain("reviewed them");
    expect(e!.plainText).not.toContain("photos or video");
    // The "up to" removal allowance is shown separately and never added to the price.
    expect(e!.plainText).toContain("Removal of old insulation, if needed: up to $1,650");
    expect(e!.plainText).toContain(REMOVAL_UPTO_NOTE);
    expect(e!.plainText).toContain("$2,948");
  });
  test("no-insulation owners keep the original assumption wording", () => {
    const e = renderJoOutcomeEmail({ ...input, insulation: "none", declaredThinPatchy: false, figures: { ...input.figures, removalUpTo: null } });
    expect(e!.plainText).toContain("assumes there is no existing ceiling insulation");
    expect(e!.plainText).not.toContain(THIN_PATCHY_SAVE_SPOT_LINE);
  });
});
