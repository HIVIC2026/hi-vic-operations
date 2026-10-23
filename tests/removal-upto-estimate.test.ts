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
    expect(removalUpTo({ insulation: "unknown", areaM2: 120, ratePerM2: 15 })).toBeNull();
    expect(removalUpTo({ insulation: "present", areaM2: 120, ratePerM2: 15, removalItemised: true })).toBeNull();
  });
  test("email shows the line for existing insulation without changing the price; 'none' email unchanged", () => {
    const a = renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible", recipient, links, figures: { ...fig, removalUpTo: 1800 } } as never)!;
    const plain = renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, deskCheckStatus: "looks_eligible", recipient, links, figures: fig } as never)!;
    expect(a.html).toContain(removalUpToLine(1800));
    expect(a.html).toContain("$3,948");
    expect(a.html.replace(/<table[^>]*FDF2F6[^]*?<\/table>/, "")).not.toContain("up to $1,800");
    const none = renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, deskCheckStatus: null, recipient, links, figures: fig } as never)!;
    expect(none.html).not.toContain("only if needed");
    expect(plain.html).not.toContain("only if needed");
    expect(REMOVAL_UPTO_NOTE).toBe("This is extra and NOT included in the price above. Often only part of the ceiling needs it, and some may be fine to stay. Your installer confirms at your free Ready Check.");
  });
  test("reminder SMS adds '(plus removal if needed)' only for existing insulation", () => {
    expect(blastMessage("Jo", 3948, 1050, "L", true)).toContain("just $3,948 (plus removal if needed), with $1,050 off thanks to the rebate.");
    expect(blastMessage("Jo", 3948, 1050, "L")).toBe("Home Insulation Victoria: Hi Jo, a warmer winter and cooler summer are close. Your ceiling insulation is just $3,948, with $1,050 off thanks to the rebate. Spots are filling fast — save yours now: L. Reply STOP to opt out.");
  });
});
