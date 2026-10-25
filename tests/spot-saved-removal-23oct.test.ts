import { describe, expect, test } from "bun:test";
import { renderSpotSavedEmail, SPOT_SAVED_NOT_INCLUDED } from "../src/lib/spot-saved-messages.core";
import { REMOVAL_BUDGET_EMAIL_NOTE } from "../src/lib/estimate-removal.core";

const base = { firstName: "Ann", rebate: 1400, suburb: "Ballarat", shortAddress: "1 A St, Ballarat", myJobUrl: "https://estimate.homeinsulationvictoria.com.au/my-job/tok", optOutUrl: "https://x/o",
  estimate: { gross: 6698, customer: 5298, areaM2: 150, address: "1 A St, Ballarat VIC 3350", calculatorUrl: "https://x/c" } };

describe("Spot saved email removal (Jo 23 Oct; decision 70 design since 24 Oct)", () => {
  test("included: the existing-insulation card in the email, the removal fact in the text", () => {
    const e = renderSpotSavedEmail({ ...base, removal: { kind: "included", amount: 1500, areaM2: 100 } });
    expect(e.html).toContain("Your existing insulation");
    expect(e.html).toContain("If some needs removing");
    expect(e.html).toContain("only if it can't stay ($15 per m², see above)");
    expect(e.text).toContain("Removal of existing insulation");
    expect(e.text).toContain("100 m² included in this estimate; the scope and price are confirmed before you agree to anything.");
    expect(e.text).toContain("This estimate includes $1,500 inc GST for removal of 100 m²");
  });
  test("unknown: the card and the budget note, no removal line", () => {
    const e = renderSpotSavedEmail({ ...base, removal: { kind: "unknown" } });
    expect(e.html).toContain("Your existing insulation");
    expect(e.text).toContain(REMOVAL_BUDGET_EMAIL_NOTE); expect(e.text).not.toContain("Ready Check"); // decision 388
    expect(e.text).not.toContain("Removal of existing insulation:");
  });
  test("excluded: nothing about removal beyond the standard not-included row", () => {
    const e = renderSpotSavedEmail({ ...base, removal: { kind: "excluded" } });
    expect(e.html).not.toContain("Your existing insulation");
    expect(e.text).not.toMatch(/Removal of existing insulation|budget \$15/i);
    expect(e.html).not.toMatch(/budget \$15/);
  });
  test("electrical fixes are 'not included' for everyone, html and text", () => {
    for (const r of [null, { kind: "excluded" as const }]) {
      const e = renderSpotSavedEmail({ ...base, removal: r });
      expect(e.text).toContain("+ Electrical fixes, if the safety check finds any");
      expect(e.html).toContain("<strong>Electrical fixes</strong>, if the safety check finds any");
    }
    // Owners without a saved estimate still get the sentence.
    const noEst = renderSpotSavedEmail({ ...base, estimate: null });
    expect(noEst.text).toContain(SPOT_SAVED_NOT_INCLUDED);
  });
});
