// Part 2 final fix wave: not-eligible button opens the homeowner page, save-my-spot emails drop "See your full estimate",
// install-days email uses the shared rest-of-payment sentence (decision 11, Jo 2 Nov 2026).
import { expect, test } from "bun:test";
import * as K from "../src/lib/email-kit.core";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";

const EST = "https://estimate.homeinsulationvictoria.com.au/estimate/tok";
const FIG = { veuRebate: 1610, customerTotal: 2188, totalBeforeRebate: 3798, installation: 3100, piesaFee: 349, apFee: 349, ceilingAreaM2: 137, areaEstimated: false, removalUpTo: 2055 };
const mail = (outcome: string, insulation: string | null) => renderJoOutcomeEmail({
  outcome, insulation, ceilingSizeKnown: true, figures: FIG, reason: "Built after 2010.",
  recipient: { firstName: "Helen", propertyAddress: "824 High Street Road, Glen Waverley VIC 3150", enquiryReference: "HV-3117" },
  links: { saveMySpotUrl: `${EST}/campaign`, uploadMediaUrl: `${EST}/video`, reviewResultUrl: EST, calculatorUrl: `${EST}/calculator` },
} as never)!;

test("not eligible: Review my result opens the homeowner page, not the estimate page", () => {
  const m = mail("does_not_appear_eligible", null);
  expect(m.html).toContain(`href="${K.HOMEOWNER_PAGE_URL}"`);
  expect(m.html).not.toContain(`href="${EST}"`);
  expect(m.plainText).toContain(`Review my result: ${K.HOMEOWNER_PAGE_URL}`);
  expect(m.plainText).not.toContain(EST);
});

test("save-my-spot emails carry no 'See your full estimate' link", () => {
  for (const [o, i] of [["likely_eligible", "none"], ["likely_eligible", "present"], ["needs_onsite_confirmation", "unknown"]] as const) {
    const m = mail(o, i);
    expect(m.html).not.toContain("See your full estimate");
    expect(m.plainText).not.toContain("See your full estimate");
    expect(m.html).not.toContain(`href="${EST}"`);
    expect(m.plainText).not.toContain(`${EST}\n`);
  }
  expect(mail("likely_eligible", "none").html).toContain("You'll see your exact price before you agree to anything.");
});

// (The O33 install days email was removed 2 Nov 2026, Part 4 Task 14; its rest-of-payment test went with it.)
