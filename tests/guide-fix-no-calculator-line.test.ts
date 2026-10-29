/**
 * Guide fix 1 (Jo, 29 Oct 2026): owner emails never send people to the calculator.
 * The "Try a different ceiling size" line is removed from O1, the O2 versions and O66/O67/O68.
 * Would fail if any of these emails still printed the line or linked the customer's calculator.
 */
import { describe, expect, test } from "bun:test";
import { renderJoOutcomeEmail, type JoOutcomeEmailInput } from "../src/lib/jo-outcome-email.core";
import { renderEstimateFollowupEmail } from "../src/lib/estimate-followup.core";
import { renderSpotSavedEmail } from "../src/lib/spot-saved-messages.core";

const TOK = "https://estimate.homeinsulationvictoria.com.au/estimate/tok";
const CALC = `${TOK}#calculator`;
const FIG = { veuRebate: 1325, customerTotal: 3747, totalBeforeRebate: 5072, installation: 4023, piesaFee: 349, apFee: 700, ceilingAreaM2: 150, areaEstimated: true };
const WHO = { firstName: "Alex", propertyAddress: "1 Test St, St Kilda VIC 3182", enquiryReference: "HV-TEST" };
const LINKS = { saveMySpotUrl: `${TOK}/campaign`, uploadMediaUrl: `${TOK}/video`, reviewResultUrl: TOK, calculatorUrl: CALC };
const input = (o: Partial<JoOutcomeEmailInput>): JoOutcomeEmailInput => ({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false, recipient: WHO, figures: FIG, links: LINKS, ...o });

const SAVE_SPOT_EMAILS: Array<[string, Partial<JoOutcomeEmailInput>]> = [
  ["O1 no insulation", { insulation: "none", ceilingSizeKnown: false }],
  ["O1 size known", { insulation: "none", ceilingSizeKnown: true, figures: { ...FIG, areaEstimated: false } }],
  ["O2 some insulation", { insulation: "present", deskCheckStatus: "looks_eligible", ceilingSizeKnown: false }],
  ["O2 don't know", { outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false }],
  ["O2 3 questions", { outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false, insulationQuestions: true } as Partial<JoOutcomeEmailInput>],
];

const noCalculator = (html: string, text: string) => {
  for (const s of [html, text]) {
    expect(s).not.toContain("Try a different ceiling size");
    expect(s).not.toContain("explore a different ceiling size");
    expect(s).not.toContain(CALC);
  }
};

describe("guide fix 1 — no calculator line in owner emails", () => {
  for (const [name, o] of SAVE_SPOT_EMAILS) {
    test(`${name} has no calculator line`, () => {
      const m = renderJoOutcomeEmail(input(o))!;
      expect(m).not.toBeNull();
      noCalculator(m.html, m.plainText);
    });
  }
  for (const step of ["day_2", "day_7", "day_21"] as const) {
    test(`estimate follow-up ${step} has no calculator line`, () => {
      const m = renderEstimateFollowupEmail({
        step, firstName: "Helen", rebate: 1610, price: 2188, fullPrice: 3798,
        basis: "Based on what you told us: 137 m² ceiling, no existing insulation.",
        saveUrl: `${TOK}/campaign`, calculatorUrl: CALC, unsubscribeUrl: "https://u/x",
      });
      noCalculator(m.html, m.text);
    });
  }
  test("O10 spot saved email (HTML and plain text) has no calculator line — Jo 29 Oct 2026", () => {
    const m = renderSpotSavedEmail({ firstName: "Sarah", rebate: 1470, suburb: "Ballarat", shortAddress: "12 Smith St, Ballarat", myJobUrl: `${TOK}/my-job`, optOutUrl: "https://u/x",
      estimate: { gross: 5000, customer: 3530, areaM2: 150, address: "12 Smith St, Ballarat", calculatorUrl: CALC } });
    noCalculator(m.html, m.text);
    expect(m.text).not.toContain("Try a different size");
  });
});
