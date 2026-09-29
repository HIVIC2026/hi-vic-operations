import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail, renderIneligibleOutcomeEmail } from "../src/lib/estimate-email";
import { withUnsubscribe } from "../src/lib/emailsafety.core";

const token = "A".repeat(43);
const estimateUrl = `https://quote.homeinsulationvictoria.com.au/estimate/${token}`;
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${token}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${token}`;
const common = { estimateUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1, referralUrl, reference: "HV-1001" };
const detailed = { ...common, estimatedTotal: 3747, installationPrice: 4023, assessmentFee: 349, apFee: 700, grossProjectTotal: 5072, amountPayableNow: 349, estimatedRemainingBalance: 3398 };

describe("customer outcome email renderers", () => {
  test("likely eligible leads with the complete personalised quote", () => {
    const email = withUnsubscribe(renderEstimateEmail({ ...detailed, outcome: "likely" }), unsubscribeUrl);
    for (const copy of ["Home Insulation Victoria", "GOOD NEWS", "YOUR HOME LOOKS LIKELY TO QUALIFY", "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", "Includes onsite ceiling measure-up.", "R5.0 ceiling insulation — supply &amp; install", "Home Insulation Victoria — Accredited Person Management", "Estimated project total", "Estimated VEU / VEEC discount", "YOUR ESTIMATED COST AFTER DISCOUNT", "$1,325", "$5,072", "$3,747", "$700", "Estimated ceiling size: <strong>134.1 m²", "CHANGE →", "Based on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate.", "THERE ARE NO OTHER STANDARD FEES TO ADD TO THIS ESTIMATE.", "we’ll quote it separately and get your approval", "CONFIRM MY QUOTE →", "Home Insulation Victoria manages the VEU pathway", "All prices include GST.", "KNOW SOMEONE WHO MIGHT QUALIFY?", "Reference: HV-1001", "Unsubscribe"]) expect(email.html).toContain(copy);
    for (const removed of ["$349 payable now", "PAY $349 &amp; CONTINUE", "WHAT HAPPENS NEXT"]) expect(email.html).not.toContain(removed);
    expect(email.html).not.toContain("% estimated saving");
    expect(email.plainText).toContain("Estimated ceiling size: 134.1 m² — CHANGE:");
    expect(email.plainText).toContain("we’ll quote it separately and get your approval before any additional work or cost is incurred.");
    expect(`${email.html} ${email.plainText}`).not.toMatch(/multiple providers|estimated saving|reserved capacity/i);
    expect(email.html).not.toContain("is shown to you before anything is added");
    expect(email.html).not.toContain("background-color:#ECF9F1;border-radius:14px");
    expect(email.html).not.toContain("MORE THAN AN INSULATION QUOTE.");
    const h = email.html;
    const order = ["YOUR PRELIMINARY QUOTE", "Estimated ceiling size:", "CHANGE →", "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", "R5.0 ceiling insulation — supply &amp; install", "Home Insulation Victoria — Accredited Person Management", "Estimated project total", "Estimated VEU / VEEC discount", "YOUR ESTIMATED COST AFTER DISCOUNT", "THERE ARE NO OTHER STANDARD FEES", "CONFIRM MY QUOTE"].map((t) => h.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
    expect(h.split("CONFIRM MY QUOTE →").length - 1).toBe(1);
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
    for (const copy of ["YOUR PRELIMINARY ESTIMATE IS READY", "YOU COULD STILL QUALIFY", "What we need to confirm", "Existing insulation needs confirmation.", "Roof access must be checked.", "$1,325", "$3,747", "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", "Accredited Person Management", "CHANGE →"]) expect(email.html).toContain(copy);
    expect(email.html.indexOf("YOUR PRELIMINARY QUOTE")).toBeLessThan(email.html.indexOf("What we need to confirm"));
  });

  test("shows the removal note only for a declared existing-insulation answer", () => {
    const present = renderEstimateEmail({ ...detailed, outcome: "onsite", existingInsulationPresent: true });
    const absent = renderEstimateEmail({ ...detailed, outcome: "likely", existingInsulationPresent: false });
    const note = "Existing insulation: Removal may be required and is not included in this estimate. We’ll confirm and quote it before you decide whether to proceed.";
    expect(present.html).toContain(note.replace("Existing insulation:", "<strong>Existing insulation:</strong>"));
    expect(present.plainText).toContain(note);
    expect(absent.html).not.toContain("Removal may be required");
    expect(absent.plainText).not.toContain("Removal may be required");
  });

  test("preview sample keeps AP management dynamic while only assessment/payable-now are $349", () => {
    const e = renderEstimateEmail({ ...common, estimatedTotal: 2710, veuDiscount: 2140, areaM2: 150, installationPrice: 3801, assessmentFee: 349, apFee: 700, grossProjectTotal: 4850, amountPayableNow: 349, estimatedRemainingBalance: 2361 });
    for (const t of ["$3,801", "$349", "$700", "$4,850", "$2,140", "$2,710"]) expect(e.html).toContain(t);
    expect(e.html).not.toContain("$2,361");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    for (const value of ["AP_FEE = 700", "SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE", "SAMPLE_CUSTOMER = SAMPLE_GROSS - SAMPLE_DISCOUNT", "estimatedRemainingBalance: SAMPLE_CUSTOMER - PIESA_FEE"]) expect(preview).toContain(value);
    expect(preview).not.toMatch(/bg-background|text-primary/);
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
      for (const colour of ["#3C51C4", "#07BF61", "#52C875"]) expect(email.html).toContain(colour);
    }
    const likely = renderEstimateEmail(common).html;
    expect(likely).toContain("fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800");
    expect(likely).toContain("<!--[if !mso]><!-->");
    expect(likely).toContain("<!--[if mso]>");
    expect(likely).toContain("@media only screen and (max-width:480px)");
    expect(source + preview).not.toMatch(/sendTemplateEmail|sendLovableEmail|createServerFn|supabase|fetch\(|\.insert\(|\.update\(/);
    expect(preview).toContain("Likely eligible");
    expect(preview).toContain("640 desktop");
    expect(preview).toContain("390 mobile");
  });
});
