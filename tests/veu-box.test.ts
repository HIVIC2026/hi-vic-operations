// VEU Fix 1: every estimate email ends with the "About the Victorian Energy Upgrades program" box and the factsheet link.
// Pure: renders the four Save my spot variants, nothing sent. Run alone: bun test tests/veu-box.test.ts
import { describe, expect, test } from "bun:test";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";
import { VEU_BOX_LINK, VEU_BOX_TEXT, VEU_BOX_TITLE, VEU_FACTSHEET_URL, veuBoxMj, veuBoxText } from "../src/lib/owner-wording.core";

const EST = "https://estimate.homeinsulationvictoria.com.au/estimate/tok";
const LINKS = { saveMySpotUrl: `${EST}/campaign`, uploadMediaUrl: `${EST}/video`, reviewResultUrl: EST, calculatorUrl: `${EST}/calculator` };
const HELEN = { firstName: "Helen", propertyAddress: "824 High Street Road, Glen Waverley VIC 3150", enquiryReference: "HV-3117" };
const FIG = { veuRebate: 1610, customerTotal: 2188, totalBeforeRebate: 3798, installation: 3100, piesaFee: 349, apFee: 349, ceilingAreaM2: 137, areaEstimated: false };
const base = { ceilingSizeKnown: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS };
const VARIANTS = {
  none: { outcome: "likely_eligible", insulation: "none", ...base },
  some: { outcome: "likely_eligible", insulation: "present", declaredThinPatchy: true, ...base },
  questions: { outcome: "needs_onsite_confirmation", insulation: "unknown", insulationQuestions: true, ...base },
  received: { outcome: "needs_onsite_confirmation", insulation: "unknown", insulationQuestions: true, mediaReceived: true, ...base },
} as const;

describe("VEU box", () => {
  test("approved strings", () => {
    expect(VEU_FACTSHEET_URL).toBe("https://www.energy.vic.gov.au/__data/assets/pdf_file/0028/585154/Victorian-Energy-Efficiency-Target-scheme-consumer-factsheet.pdf");
    expect(VEU_BOX_TITLE).toBe("About the Victorian Energy Upgrades program");
    expect(VEU_BOX_LINK).toBe("Read the Government's VEU consumer factsheet ›");
    expect(veuBoxText()).toEqual([VEU_BOX_TITLE, VEU_BOX_TEXT, `${VEU_BOX_LINK} ${VEU_FACTSHEET_URL}`]);
    expect(veuBoxMj()).toContain(VEU_FACTSHEET_URL);
  });
  for (const [name, input] of Object.entries(VARIANTS)) {
    test(`${name} email carries the box`, () => {
      const m = renderJoOutcomeEmail(input as never)!;
      expect(m.html.split(VEU_FACTSHEET_URL).length - 1).toBe(1);
      expect(m.html).toContain("About the Victorian Energy Upgrades program");
      expect(m.html).toContain("We&#39;re not the Victorian Government".replace("&#39;", "'"));
      const lines = m.plainText.split("\n");
      const i = lines.indexOf(VEU_BOX_TITLE);
      expect(i).toBeGreaterThan(0);
      expect(lines.slice(i, i + 3)).toEqual(veuBoxText());
      expect(lines.findIndex((l) => l.startsWith("Reference:"))).toBeGreaterThan(i + 2);
    });
  }
});
