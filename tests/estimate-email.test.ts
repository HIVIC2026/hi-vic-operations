import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail, renderIneligibleOutcomeEmail } from "../src/lib/estimate-email";
import { withUnsubscribe } from "../src/lib/emailsafety.core";

const token = "A".repeat(43);
const estimateUrl = `https://quote.homeinsulationvictoria.com.au/estimate/${token}`;
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${token}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${token}`;
const common = { estimateUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1, referralUrl, reference: "HV-1001" };

describe("customer outcome email renderers", () => {
  test("likely eligible leads with the complete personalised quote", () => {
    const email = withUnsubscribe(renderEstimateEmail({ ...common, outcome: "likely" }), unsubscribeUrl);
    for (const copy of ["Home Insulation Victoria", "GOOD NEWS", "$1,325", "$4,721", "$3,396", "134.1 m²", "28% reduction", "YOUR NEXT STEP", "MEASURE + ELECTRICAL", "CONTINUE WITH HOME INSULATION VICTORIA", "THIS ISN'T JUST AN", "approved Accredited Person", "appropriately licensed electricians", "Registered Electrical Contractors", "appropriately EEC-certified", "Capacity reserved", "WARMER IN WINTER", "COOLER IN SUMMER", "Reference: HV-1001", "Unsubscribe"]) expect(email.html).toContain(copy);
    expect(email.html.indexOf("YOUR PRELIMINARY QUOTE")).toBeLessThan(email.html.indexOf("YOUR NEXT STEP"));
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
    expect(m.html).toContain("GOOD NEWS, Alex!");
    expect(m.html).toContain("30 Dash St, Fraser Rise VIC 3336");
    expect(m.html.indexOf("ESTIMATED VEU DISCOUNT")).toBeLessThan(m.html.indexOf("YOUR ESTIMATED PRICE"));
    expect(m.html).toContain("background-color:#52C875");
    expect(renderEstimateEmail(common).html).not.toContain("30 Dash St");
  });

  test("AP count is optional and never invented", () => {
    const omitted = renderEstimateEmail({ ...common, apCount: null });
    expect(omitted.html).toContain("approved Accredited Person");
    expect(omitted.html).not.toContain("2 currently verified");
    const verified = renderEstimateEmail({ ...common, apCount: 7 });
    expect(verified.html).toContain("7 currently verified team members");
  });

  test("requires all mandatory quote values and rejects unsafe URLs", () => {
    expect(() => renderEstimateEmail({ estimateUrl, estimatedTotal: 3396, veuDiscount: 1325 })).toThrow();
    expect(() => renderEstimateEmail({ ...common, estimateUrl: "https://evil.example/estimate/x" })).toThrow();
    expect(() => renderIneligibleOutcomeEmail({ referralUrl: "https://evil.example/x", reasons: ["No"] })).toThrow();
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
    for (const label of ["Likely eligible", "Needs confirmation", "Does not appear eligible"]) expect(preview).toContain(label);
  });
});