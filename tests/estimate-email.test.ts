import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail, renderIneligibleOutcomeEmail } from "../src/lib/estimate-email";
import { withUnsubscribe } from "../src/lib/emailsafety.core";
import { CUSTOMER_BRAND, CUSTOMER_EXISTING_INSULATION_NOTE, CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_QUOTE_ORDER } from "../src/lib/customer-quote-system";

const token = "A".repeat(43);
const estimateUrl = `https://quote.homeinsulationvictoria.com.au/estimate/${token}`;
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${token}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${token}`;
const common = { estimateUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1, referralUrl, reference: "HV-1001" };
const detailed = { ...common, estimatedTotal: 3747, installationPrice: 4023, assessmentFee: 349, apFee: 700, grossProjectTotal: 5072, amountPayableNow: 349, estimatedRemainingBalance: 3398 };

describe("customer outcome email renderers", () => {
  test("likely eligible leads with the complete personalised quote", () => {
    const email = withUnsubscribe(renderEstimateEmail({ ...detailed, outcome: "likely" }), unsubscribeUrl);
    for (const copy of ["Home Insulation Victoria", "GOOD NEWS", "YOUR HOME LOOKS LIKELY TO QUALIFY", "Mandatory Pre-Installation Electrical Safety Assessment (PIESA) + onsite ceiling measure-up", "R5.0 ceiling insulation — supply &amp; install", "Home Insulation Victoria — Accredited Person Management", "Estimated project total", "Estimated VEU / VEEC discount", "YOUR ESTIMATED COST AFTER DISCOUNT", "$1,325", "$5,072", "$3,747", "$700", "Estimated ceiling size: <strong>134.1 m²", "CHANGE →", "Based on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate.", "NOT SURE YOUR CEILING SIZE IS RIGHT?", "CHECK ANOTHER CEILING SIZE →", "Calculator changes are for comparison only and do not overwrite your enquiry.", "THERE ARE NO OTHER STANDARD FEES TO ADD TO THIS ESTIMATE.", "Nothing additional is simply added without being shown to you first.", "PAY $349 &amp; CONTINUE →", "Already included in your estimated total — not an extra fee.", "If you proceed, you do not pay the $349 again.", "Home Insulation Victoria manages the VEU pathway", "All prices include GST.", "KNOW SOMEONE WHO MIGHT QUALIFY?", "Refer a friend →", "Reference: HV-1001", "Unsubscribe"]) expect(email.html).toContain(copy);
    for (const removed of ["CONFIRM MY QUOTE", "WHAT HAPPENS NEXT"]) expect(email.html).not.toContain(removed);
    expect(email.html).not.toContain("% estimated saving");
    expect(email.plainText).toContain("Estimated ceiling size: 134.1 m² — CHANGE:");
    expect(email.plainText).toContain("Nothing additional is simply added without being shown to you first.");
    expect(`${email.html} ${email.plainText}`).not.toMatch(/multiple providers|estimated saving|reserved capacity/i);
    expect(email.html).not.toContain("is shown to you before anything is added");
    expect(email.html).not.toContain("background-color:#ECF9F1;border-radius:14px");
    expect(email.html).not.toContain("MORE THAN AN INSULATION QUOTE.");
    const h = email.html;
    const order = ["YOUR PRELIMINARY QUOTE", "Estimated ceiling size:", "CHANGE →", "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", "R5.0 ceiling insulation — supply &amp; install", "Home Insulation Victoria — Accredited Person Management", "Estimated project total", "Estimated VEU / VEEC discount", "YOUR ESTIMATED COST AFTER DISCOUNT", "$349 payable now for the Measure + PIESA", "Estimated remaining balance", "THERE ARE NO OTHER STANDARD FEES", "NOT SURE YOUR CEILING SIZE IS RIGHT?", "CHECK ANOTHER CEILING SIZE →", "PAY $349 &amp; CONTINUE →"].map((t) => h.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
    expect(h.split("PAY $349 &amp; CONTINUE →").length - 1).toBe(1);
    expect(h).toContain("border-left:4px solid #07BF61");
    expect(email.plainText).toContain("PAY $349 & CONTINUE:");
    expect(email.plainText).toContain(CUSTOMER_PAYMENT_COPY.included);
    expect(h).not.toContain("CONTINUE WITH HOME INSULATION VICTORIA");
    expect(h).not.toContain("CHANGE THE CEILING SIZE FOR A REVISED ESTIMATE");
    expect(h).not.toContain("WE HANDLE THE VEU PROCESS");
    expect(h).toContain(`${estimateUrl}#calculator`);
    expect(`${h} ${email.plainText}`).not.toMatch(/RESERVED CAPACITY|WHY INSULATE/);
    expect(email.html).not.toContain("YOUR ANSWERS HAVEN'T RULED YOU OUT");
    expect(email.html.split("All prices include GST.").length - 1).toBe(1);
    expect(email.html).not.toContain("AUD incl. GST");
    expect(email.html).not.toMatch(/>HI VIC</);
  });

  test("onsite confirmation remains positive and renders dynamic reasons", () => {
    const email = renderEstimateEmail({ ...detailed, outcome: "onsite", reasons: ["Existing insulation needs confirmation.", "Roof access must be checked."] });
    for (const copy of ["YOUR PRELIMINARY ESTIMATE IS READY", "YOU COULD STILL QUALIFY — WE JUST NEED TO CONFIRM A FEW THINGS.", "What we need to confirm", "Existing insulation needs confirmation.", "Roof access must be checked.", "YOUR ANSWERS HAVEN'T RULED YOU OUT.", "$1,325", "$3,747", "$3,398", CUSTOMER_QUOTE_LABELS.piesa, "Accredited Person Management", "CHANGE →", "CHECK ANOTHER CEILING SIZE →", "PAY $349 &amp; CONTINUE →", CUSTOMER_PAYMENT_COPY.included, CUSTOMER_PAYMENT_COPY.notAgain]) expect(email.html).toContain(copy);
    expect(email.html.indexOf("YOUR PRELIMINARY QUOTE")).toBeLessThan(email.html.indexOf("What we need to confirm"));
    expect(email.html).toContain(`${estimateUrl}#calculator`);
    expect(email.html.split("PAY $349 &amp; CONTINUE →").length - 1).toBe(1);
  });

  test("shows the removal note only for a declared existing-insulation answer", () => {
    const present = renderEstimateEmail({ ...detailed, outcome: "onsite", existingInsulationPresent: true });
    const absent = renderEstimateEmail({ ...detailed, outcome: "likely", existingInsulationPresent: false });
    expect(present.html).toContain(CUSTOMER_EXISTING_INSULATION_NOTE);
    expect(present.plainText).toContain(CUSTOMER_EXISTING_INSULATION_NOTE);
    expect(absent.html).not.toContain(CUSTOMER_EXISTING_INSULATION_NOTE);
    expect(absent.plainText).not.toContain(CUSTOMER_EXISTING_INSULATION_NOTE);
  });

  test("preview sample keeps AP management dynamic while only assessment/payable-now are $349", () => {
    const e = renderEstimateEmail({ ...common, estimatedTotal: 3716.24, veuDiscount: 1481.76, areaM2: 150, installationPrice: 4500, assessmentFee: 349, apFee: 349, grossProjectTotal: 5198, amountPayableNow: 349, estimatedRemainingBalance: 3367.24 });
    for (const t of ["$4,500", "$349", "$5,198", "$1,482", "$3,716"]) expect(e.html).toContain(t);
    expect(e.html).not.toContain("$2,361");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    for (const value of ["AP_FEE = 349", "SAMPLE_INSTALL = 4500", "SAMPLE_DISCOUNT = 1481.76", "SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE", "SAMPLE_CUSTOMER = SAMPLE_GROSS - SAMPLE_DISCOUNT", "estimatedRemainingBalance: SAMPLE_CUSTOMER - PIESA_FEE"]) expect(preview).toContain(value);
    expect(preview).not.toMatch(/bg-background|text-primary/);
  });

  test("ineligible has dynamic reasons, no available discount, result CTA and referral", () => {
    const resultUrl = `${estimateUrl}#result`;
    const email = withUnsubscribe(renderIneligibleOutcomeEmail({ referralUrl, resultUrl, reasons: ["The home is five years old or newer.", "A previous Activity 48 upgrade was confirmed."], reference: "HV-1003" }), unsubscribeUrl);
    for (const copy of ["WE'VE COMPLETED YOUR PROPERTY CHECK.", "THIS PROPERTY DOESN'T CURRENTLY APPEAR ELIGIBLE.", "WHY WE REACHED THIS RESULT", "five years old or newer", "previous Activity 48 upgrade", "REVIEW MY RESULT →", "KNOW SOMEONE WHO MIGHT QUALIFY?", "Refer a friend →", "Reference: HV-1003", "Unsubscribe", "home-insulation-victoria-logo.png"]) expect(email.html).toContain(copy);
    expect(email.html).toContain(`href="${resultUrl}"`);
    expect(email.html).not.toMatch(/estimated VEU discount|ESTIMATED CUSTOMER PRICE|PAY \$349|assessment payment available|\$1,325/i);
    expect(email.html).not.toContain("WHY INSULATION MATTERS");
    expect(email.html).not.toContain("COMFORT THROUGH THE SEASONS");
    expect(() => renderIneligibleOutcomeEmail({ referralUrl, resultUrl: `${estimateUrl}#confirm`, reasons: ["No"] })).toThrow();
  });

  test("sample-only personalisation and premium money card", () => {
    const m = renderEstimateEmail({ ...common, firstName: "Alex", address: "30 Dash St, Fraser Rise VIC 3336" });
    expect(m.html).toContain("GOOD NEWS, ALEX.");
    expect(m.html).toContain("30 Dash St, Fraser Rise VIC 3336");
    expect(m.html).toContain("PROPERTY");
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
    expect(email.plainText).toContain("R5.0 ceiling insulation — supply & install: $4,023");
    expect(renderEstimateEmail(common).html).not.toContain("Accredited Person Management");
    expect(() => renderEstimateEmail({ ...detailed, grossProjectTotal: 5000 })).toThrow();
    expect(() => renderEstimateEmail({ ...detailed, estimatedRemainingBalance: 3000 })).toThrow();
    expect(() => renderEstimateEmail({ ...detailed, apFee: 850, grossProjectTotal: 5222, estimatedTotal: 3897, estimatedRemainingBalance: 3548 })).not.toThrow();
    expect(() => renderEstimateEmail({ ...detailed, assessmentFee: 350, grossProjectTotal: 5073, estimatedTotal: 3748, estimatedRemainingBalance: 3399 })).toThrow();
    expect(() => renderEstimateEmail({ ...common, assessmentFee: 349 })).toThrow();
    expect(`${email.html} ${email.plainText}`).not.toContain("Pleased to meet you");
  });

  test("uses email-safe markup, loads Open Sans for likely, and remains a pure renderer", () => {
    const source = readFileSync("src/lib/estimate-email.ts", "utf8");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    for (const email of [renderEstimateEmail(common), renderIneligibleOutcomeEmail({ referralUrl, reasons: ["Fixture reason"] })]) {
      expect(email.html).not.toMatch(/<script\b|\son\w+=/i);
      expect(email.html).toContain("max-width:640px");
      expect(email.html).toContain("font-family:'Open Sans',Arial,Helvetica,sans-serif");
      for (const colour of ["#3C51C4", "#07BF61"]) expect(email.html).toContain(colour);
    }
    const likely = renderEstimateEmail(common).html;
    expect(likely).toContain("#52C875");
    expect(likely).toContain("fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800");
    expect(likely).toContain("<!--[if !mso]><!-->");
    expect(likely).toContain("<!--[if mso]>");
    expect(likely).toContain("@media only screen and (max-width:480px)");
    expect(source + preview).not.toMatch(/sendTemplateEmail|sendLovableEmail|createServerFn|supabase|fetch\(|\.insert\(|\.update\(/);
    expect(preview).toContain("Likely eligible");
    expect(preview).toContain("Test CHECK ANOTHER CEILING SIZE →");
    expect(preview).toContain("Test REVIEW MY RESULT →");
    expect(preview).toContain("640 desktop");
    expect(preview).toContain("390 mobile");
  });

  test("shares the canonical brand and quote order across eligible outcomes", () => {
    expect(CUSTOMER_BRAND).toEqual({ name: "Home Insulation Victoria", logoUrl: "https://homeinsulationvictoria.com.au/home-insulation-victoria-logo.png", colors: { blue: "#3C51C4", green: "#07BF61", accent: "#52C875", offWhite: "#FBFCFA", navy: "#22376B", white: "#FFFFFF" }, font: "'Open Sans',Arial,Helvetica,sans-serif" });
    for (const outcome of ["likely", "onsite"] as const) {
      const email = renderEstimateEmail({ ...detailed, outcome });
      const indexes = CUSTOMER_QUOTE_ORDER.map((label) => email.plainText.indexOf(label));
      expect(indexes.every((index, position) => index >= 0 && (position === 0 || index > indexes[position - 1]!))).toBe(true);
      expect(`${email.html} ${email.plainText}`).not.toMatch(/\bHI VIC\b/);
    }
    const ineligible = renderIneligibleOutcomeEmail({ referralUrl, reasons: ["Fixture reason"] });
    expect(ineligible.html).toContain(CUSTOMER_BRAND.logoUrl);
    expect(ineligible.html).toContain(CUSTOMER_BRAND.font);
    expect(`${ineligible.html} ${ineligible.plainText}`).not.toMatch(/PAY \$349|YOUR PRELIMINARY QUOTE|Estimated project total|\bHI VIC\b/);
  });
});
