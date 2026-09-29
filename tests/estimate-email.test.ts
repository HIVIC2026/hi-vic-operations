import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail, renderIneligibleOutcomeEmail } from "../src/lib/estimate-email";
import { withUnsubscribe } from "../src/lib/emailsafety.core";

const token = "A".repeat(43);
const estimateUrl = `https://quote.homeinsulationvictoria.com.au/estimate/${token}`;
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${token}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${token}`;
const common = { estimateUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1, referralUrl, reference: "HV-1001" };
const detailed = { ...common, installationPrice: 3200, assessmentFee: 349, apFee: 1172, grossProjectTotal: 4721, amountPayableNow: 349, estimatedRemainingBalance: 3047 };

describe("customer outcome email renderers", () => {
  test("likely eligible leads with the complete personalised quote", () => {
    const email = withUnsubscribe(renderEstimateEmail({ ...detailed, outcome: "likely" }), unsubscribeUrl);
    for (const copy of ["Home Insulation Victoria", "GOOD NEWS", "YOUR HOME LOOKS LIKELY TO QUALIFY", "R5.0 ceiling insulation installation", "Onsite Measure + Electrical Safety Assessment", "Included in your total", "AP &amp; Compliance Management", "Estimated project total", "Estimated VEU / VEEC discount", "YOUR ESTIMATED COST AFTER DISCOUNT", "$1,325", "$4,721", "$3,396", "$349 payable now", "not an extra charge", "will not pay this assessment fee again", "$3,047", "PAY $349 &amp; CONTINUE", "WHAT COULD CHANGE AFTER THE ASSESSMENT?", "Nothing additional is simply added without being shown to you first.", "134.1 m²", "28% estimated saving", "THIS IS MORE THAN AN", "YOU'RE IN THE RIGHT HANDS.", "YOUR NEXT STEP", "KNOW SOMEONE WHO MIGHT QUALIFY?", "Reference: HV-1001", "Unsubscribe"]) expect(email.html).toContain(copy);
    expect(email.html.indexOf("ESTIMATED VEU DISCOUNT")).toBeLessThan(email.html.indexOf("YOUR NEXT STEP"));
    expect(email.html).not.toContain("YOUR ANSWERS HAVEN'T RULED YOU OUT");
    expect(email.html).not.toMatch(/>HI VIC</);
  });

  test("onsite confirmation remains positive and renders dynamic reasons", () => {
    const email = renderEstimateEmail({ ...common, outcome: "onsite", reasons: ["Existing insulation needs confirmation.", "Roof access must be checked."] });
    for (const copy of ["YOUR PRELIMINARY ESTIMATE IS READY", "YOU COULD STILL QUALIFY", "What we need to confirm", "Existing insulation needs confirmation.", "Roof access must be checked.", "$1,325", "$3,396"]) expect(email.html).toContain(copy);
    expect(email.html.indexOf("YOUR PRELIMINARY QUOTE")).toBeLessThan(email.html.indexOf("What we need to confirm"));
  });

  test("ineligible has dynamic reasons, no available discount, result CTA and referral", () => {
    const email = withUnsubscribe(renderIneligibleOutcomeEmail({ referralUrl, reasons: ["The home is five years old or newer.", "A previous Activity 48 upgrade was confirmed."], reference: "HV-1003" }), unsubscribeUrl);
    for (const copy of ["THIS PROPERTY DOES NOT APPEAR ELIGIBLE", "Why we reached this result", "five years old or newer", "previous Activity 48 upgrade", "REVIEW MY RESULT", "REFER A FRIEND", "Reference: HV-1003", "Unsubscribe"]) expect(email.html).toContain(copy);
    expect(email.html).not.toMatch(/estimated VEU discount|ESTIMATED CUSTOMER PRICE|\$1,325/i);
  });

  test("sample-only personalisation and premium money card", () => {
    const m = renderEstimateEmail({ ...common, firstName: "Alex", address: "30 Dash St, Fraser Rise VIC 3336" });
    expect(m.html).toContain("GOOD NEWS, ALEX.");
    expect(m.html).toContain("30 Dash St, Fraser Rise VIC 3336");
    expect(m.html.indexOf("ESTIMATED VEU DISCOUNT")).toBeLessThan(m.html.indexOf("YOUR ESTIMATED COST AFTER DISCOUNT"));
    expect(m.html).toContain("background-color:#52C875");
    expect(renderEstimateEmail(common).html).not.toContain("30 Dash St");
  });

  test("AP count states approved Accredited Persons, never staff", () => {
    const omitted = renderEstimateEmail({ ...common, apCount: null });
    expect(omitted.html).not.toContain("ONE OF ONLY");
    expect(omitted.plainText).not.toContain("one of only");
    const verified = renderEstimateEmail({ ...common, apCount: 7 });
    expect(verified.html).toContain("ONE OF ONLY 7 ACCREDITED PERSONS CURRENTLY APPROVED FOR ACTIVITY 48 IN VICTORIA");
    expect(verified.plainText).toContain("one of only 7 Accredited Persons currently approved for VEU Activity 48 in Victoria");
    for (const email of [omitted, verified, renderIneligibleOutcomeEmail({ referralUrl })]) {
      expect(`${email.html} ${email.plainText}`).not.toMatch(/team member|staff/i);
    }
  });

  test("requires all mandatory quote values and rejects unsafe URLs", () => {
    expect(() => renderEstimateEmail({ estimateUrl, estimatedTotal: 3396, veuDiscount: 1325 })).toThrow();
    expect(() => renderEstimateEmail({ ...common, estimateUrl: "https://evil.example/estimate/x" })).toThrow();
    expect(() => renderIneligibleOutcomeEmail({ referralUrl: "https://evil.example/x", reasons: ["No"] })).toThrow();
  });

  test("validates detailed quote arithmetic and never fabricates missing line items", () => {
    const email = renderEstimateEmail(detailed);
    expect(email.plainText).toContain("R5.0 ceiling insulation installation: $3,200");
    expect(renderEstimateEmail(common).html).not.toContain("AP &amp; Compliance Management");
    expect(() => renderEstimateEmail({ ...detailed, grossProjectTotal: 4700 })).toThrow();
    expect(() => renderEstimateEmail({ ...detailed, estimatedRemainingBalance: 3000 })).toThrow();
    expect(() => renderEstimateEmail({ ...common, assessmentFee: 349 })).toThrow();
  });

  test("uses email-safe markup and remains a pure renderer", () => {
    const source = readFileSync("src/lib/estimate-email.ts", "utf8");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    for (const email of [renderEstimateEmail(common), renderIneligibleOutcomeEmail({ referralUrl, reasons: ["Fixture reason"] })]) {
      expect(email.html).not.toMatch(/<script\b|class=|<style\b/i);
      expect(email.html).toContain("max-width:640px");
      expect(email.html).toContain("font-family:'Open Sans',Arial,Helvetica,sans-serif");
      for (const colour of ["#3C51C4", "#07BF61", "#52C875"]) expect(email.html).toContain(colour);
    }
    expect(source + preview).not.toMatch(/sendTemplateEmail|sendLovableEmail|createServerFn|supabase|fetch\(|\.insert\(|\.update\(/);
    expect(preview).toContain("likely-eligible");
  });
});
