import { describe, expect, test } from "bun:test";
import { removalUpTo, removalUpToLine, REMOVAL_UPTO_NOTE } from "../src/lib/estimate-removal-upto.core";
import { blastMessage } from "../src/lib/save-spot-reminder-blast.core";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";

const base = "https://estimate.homeinsulationvictoria.com.au/estimate/" + "T".repeat(43);
const links = { saveMySpotUrl: base + "/campaign", uploadMediaUrl: base + "/video", reviewResultUrl: base, calculatorUrl: base + "/calculator" };
const recipient = { firstName: "Jo", propertyAddress: "1 Test Street, Mulgrave VIC 3170", enquiryReference: "HV-TEST" };
const fig = { veuRebate: 1050, customerTotal: 3948, totalBeforeRebate: 4998, installation: 3600, piesaFee: 349, apFee: 349, ceilingAreaM2: 120, areaEstimated: false };

describe("removal 'up to' amount (Jo 22 Oct)", () => {
  test("area × current removal rate, only when insulation is present", () => {
    expect(removalUpTo({ insulation: "present", areaM2: 120, ratePerM2: 15 })).toBe(1800);
    expect(removalUpTo({ insulation: "none", areaM2: 120, ratePerM2: 15 })).toBeNull();
    expect(removalUpTo({ insulation: "unknown", areaM2: 120, ratePerM2: 15 })).toBe(1800); // Jo 23 Oct 6:13pm: don't know also shows removal
    expect(removalUpTo({ insulation: "present", areaM2: 120, ratePerM2: 15, removalItemised: true })).toBeNull();
  });
  test("email shows the line for existing insulation without changing the price; 'none' email unchanged", () => {
    const a = renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible", recipient, links, figures: { ...fig, removalUpTo: 1800 } } as never)!;
    const plain = renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible", recipient, links, figures: fig } as never)!;
    // Decision 67 design: the "Your existing insulation" card shows the up-to figure; the price box is unchanged.
    expect(a.html).toContain("Up to $1,800 for your 120 m² ceiling.");
    expect(a.html).toContain("$15/m²");
    expect(a.html).toContain("$3,948");
    expect(a.html.replace(/Your existing insulation[^]*?Prices incl\. GST/, "")).not.toContain("$1,800");
    expect(removalUpToLine(1800)).toBe("Removal of old insulation, only if needed: $0 – $1,800");
    const none = renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, deskCheckStatus: null, recipient, links, figures: fig } as never)!;
    expect(none.html).not.toContain("Your existing insulation");
    // Without the informational figure the approved $15/m² rate still applies (never part of the total).
    expect(plain.html).toContain("Up to $1,800 for your 120 m² ceiling.");
    expect(REMOVAL_UPTO_NOTE).toBe("We charge $15 per m² (inc GST) for any area that needs removing. It may not need to come out at all — your free Ready Check confirms this, and you'll see the final price before you agree to anything.");
  });
  test("reminder SMS adds '(plus removal if needed)' only for existing insulation", () => {
    expect(blastMessage("Jo", 3948, 1050, "L", true)).toContain("just $3,948 (plus removal if needed), with $1,050 off thanks to the rebate.");
    expect(blastMessage("Jo", 3948, 1050, "L")).toBe("Home Insulation Victoria: Hi Jo, a warmer winter and cooler summer are close. Your ceiling insulation is just $3,948, with $1,050 off thanks to the rebate. Spots are filling fast — save yours now: L. Reply STOP to opt out.");
  });
});
