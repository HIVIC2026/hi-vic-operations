import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail, renderIneligibleOutcomeEmail } from "../src/lib/estimate-email";
import { withUnsubscribe } from "../src/lib/emailsafety.core";
const CUSTOMER_VISUAL_SYSTEM_BORDER = "border:1px solid #D4DAF5";
import { CUSTOMER_BRAND, CUSTOMER_EXISTING_INSULATION_NOTE, CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_QUOTE_ORDER, CUSTOMER_WHAT_COULD_CHANGE } from "../src/lib/customer-quote-system";

const token = "A".repeat(43);
const estimateUrl = `https://quote.homeinsulationvictoria.com.au/estimate/${token}`;
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${token}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${token}`;
const common = { estimateUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1, referralUrl, reference: "HV-1001" };
const detailed = { ...common, estimatedTotal: 3747, installationPrice: 4023, assessmentFee: 349, apFee: 700, grossProjectTotal: 5072, amountPayableNow: 99, estimatedRemainingBalance: 3648 };

describe("customer outcome email renderers", () => {
  test("likely eligible leads with the complete personalised quote", () => {
    const email = withUnsubscribe(renderEstimateEmail({ ...detailed, outcome: "likely" }), unsubscribeUrl);
    for (const copy of ["Home Insulation Victoria", "GOOD NEWS", "YOUR HOME LOOKS LIKELY TO QUALIFY", "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", "R5.0 ceiling insulation — supply &amp; install", "Home Insulation Victoria — Accredited Person Management", "Estimated project total", "Estimated VEU / VEEC discount", "YOUR ESTIMATED COST AFTER DISCOUNT", "$1,325", "$5,072", "$3,747", "$700", "Estimated ceiling size: <strong>134.1 m²", "CHANGE →", "Based on the estimated ceiling size provided in your enquiry. Change it to see a revised estimate.", "WHAT COULD CHANGE MY ESTIMATE?", "WANT TO CHECK THE NUMBERS FIRST?", "TRY ANOTHER PROPERTY OR CEILING SIZE", "your property address and the 134.1 m² ceiling size", "a different Victorian property address or ceiling size", "OPEN THE INTERACTIVE CALCULATOR →", "Calculator changes are for comparison only and do not overwrite your enquiry.", "NEXT STEP", "BOOK YOUR HOME INSULATION READY CHECK", "For $99, we’ll arrange your onsite Ready Check so we can measure your ceiling and prepare a more accurate project estimate.", "The $99 is credited toward your project if you proceed.", "BOOK MY READY CHECK →", "See exactly what’s included on the next page.", "All prices include GST.", "KNOW SOMEONE WHO MIGHT QUALIFY?", "REFER A FRIEND →", "They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.", "Reference: HV-1001", "Unsubscribe"]) expect(email.html).toContain(copy);
    for (const removed of ["CONFIRM MY QUOTE", "WHAT HAPPENS NEXT"]) expect(email.html).not.toContain(removed);
    expect(email.html).not.toContain("% estimated saving");
    expect(email.plainText).toContain("Estimated ceiling size: 134.1 m² — CHANGE:");
    for (const removed of ["One of our insulation partners visits", "The Ready Check is not the mandatory electrical safety assessment", "If the Ready Check identifies something", CUSTOMER_PAYMENT_COPY.notPiesa, CUSTOMER_PAYMENT_COPY.purpose]) expect(`${email.html} ${email.plainText}`).not.toContain(removed);
    expect(`${email.html} ${email.plainText}`).not.toMatch(/multiple providers|estimated saving|reserved capacity/i);
    expect(email.html).not.toContain("is shown to you before anything is added");
    expect(email.html).not.toContain("background-color:#ECF9F1;border-radius:14px");
    expect(email.html).not.toContain("MORE THAN AN INSULATION QUOTE.");
    const h = email.html;
    const order = ["YOUR PRELIMINARY QUOTE", "Estimated ceiling size:", "CHANGE →", "Mandatory Pre-Installation Electrical Safety Assessment (PIESA)", "R5.0 ceiling insulation — supply &amp; install", "Home Insulation Victoria — Accredited Person Management", "Estimated project total", "Estimated VEU / VEEC discount", "YOUR ESTIMATED COST AFTER DISCOUNT", "WHAT COULD CHANGE MY ESTIMATE?", "NEXT STEP", "BOOK MY READY CHECK →", "WANT TO CHECK THE NUMBERS FIRST?", "OPEN THE INTERACTIVE CALCULATOR →"].map((t) => h.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
    expect(h.split("BOOK MY READY CHECK →").length - 1).toBe(1);
    const mainQuoteStart = h.indexOf('data-main-quote-card="true"');
    const mainQuoteEnd = h.indexOf("WANT TO CHECK THE NUMBERS FIRST?");
    const mainQuote = h.slice(mainQuoteStart, mainQuoteEnd);
    expect(mainQuote).toContain('data-ready-check-inside-quote="true"');
    expect(mainQuote).toContain("BOOK MY READY CHECK →");
    expect(h.split('data-ready-check-inside-quote="true"').length - 1).toBe(1);
    expect(h.split('bgcolor="#ECF9F1"').length - 1).toBe(1); expect(h).toContain('data-discount-band="true" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ECF9F1"'); expect(h.indexOf('data-discount-band')).toBeLessThan(h.indexOf('YOUR ESTIMATED COST AFTER DISCOUNT')); expect(h).toContain('−$'); expect(h.split('WHAT COULD CHANGE MY ESTIMATE?').length - 1).toBe(1);
    expect(h).toContain("border-radius:16px");
    expect(h).toContain("border:1px solid #D4DAF5");
    expect(`${email.html} ${email.plainText}`).toContain("could change your estimated project total, VEU / VEEC discount and estimated cost after discount.");
    expect(`${email.html} ${email.plainText}`).not.toContain("VEU discount and estimated price could change.");
    expect(email.plainText).toContain("BOOK MY READY CHECK →:");
    expect(`${email.html} ${email.plainText}`).not.toContain("PAY $349 & CONTINUE");
    const htmlQuote = h.slice(h.indexOf("YOUR PRELIMINARY QUOTE"), h.indexOf("NEXT STEP"));
    const textQuote = email.plainText.slice(email.plainText.indexOf("YOUR PRELIMINARY QUOTE"), email.plainText.indexOf("NEXT STEP"));
    for (const quote of [htmlQuote, textQuote]) {
      expect(quote).not.toContain(CUSTOMER_QUOTE_LABELS.payableNow);
      expect(quote).not.toContain(CUSTOMER_PAYMENT_COPY.credited);
      expect(quote).not.toContain("Estimated remaining project balance after Ready Check");
    }
    for (const copy of ["NEXT STEP", "BOOK YOUR HOME INSULATION READY CHECK", "For $99, we’ll arrange your onsite Ready Check so we can measure your ceiling and prepare a more accurate project estimate.", "The $99 is credited toward your project if you proceed."]) {
      expect(h.split(copy).length - 1).toBe(1);
      expect(email.plainText.split(copy).length - 1).toBe(1);
    }
    expect(h).not.toContain("CONTINUE WITH HOME INSULATION VICTORIA");
    expect(h).not.toContain("CHANGE THE CEILING SIZE FOR A REVISED ESTIMATE");
    expect(h).not.toContain("WE HANDLE THE VEU PROCESS");
    expect(h).toContain(`${estimateUrl}#calculator`);
    expect(h).toContain(`${estimateUrl}#confirm`);
    expect(`${email.html} ${email.plainText}`).not.toMatch(/NOT SURE YOUR CEILING SIZE IS RIGHT\?|CHECK ANOTHER CEILING SIZE →/);
    expect(`${h} ${email.plainText}`).not.toMatch(/RESERVED CAPACITY|WHY INSULATE/);
    expect(email.html).not.toContain("IT'S LOOKING GOOD SO FAR");
    expect(email.html.split("All prices include GST.").length - 1).toBe(1);
    expect(email.html).not.toContain("AUD incl. GST");
    expect(email.html).not.toMatch(/>HI VIC</);
    for (const output of [email.html, email.plainText]) {
      expect(output).not.toContain("THERE ARE NO OTHER STANDARD FEES TO ADD TO THIS ESTIMATE.");
      expect(output).not.toContain("Final eligibility, eligible area, VEU discount and price are confirmed after");
      expect(output).toContain(CUSTOMER_WHAT_COULD_CHANGE.heading);
      expect(output).toContain(CUSTOMER_WHAT_COULD_CHANGE.intro);
      expect(output).toContain(CUSTOMER_WHAT_COULD_CHANGE.closing);
      const points = CUSTOMER_WHAT_COULD_CHANGE.items.map(({ lead }) => output.indexOf(lead));
      expect(points.every((index, position) => index >= 0 && (position === 0 || index > points[position - 1]!))).toBe(true);
    }
  });

  test("onsite confirmation remains positive and renders dynamic reasons", () => {
    const email = renderEstimateEmail({ ...detailed, outcome: "onsite", reasons: ["existing_insulation_unknown", "Existing insulation needs confirmation.", "roof_access_review", "eligible_ceiling_area_unverified"] });
    for (const copy of ["IT'S LOOKING GOOD SO FAR.", "WE JUST NEED TO CHECK A COUPLE OF THINGS ONSITE:", "Existing insulation — confirm what is currently installed and whether removal is required.", "Ceiling access — confirm access conditions and whether any access adjustment applies.", "Ceiling area — confirm the measured eligible ceiling area.", "$1,325", "$3,747", CUSTOMER_QUOTE_LABELS.piesa, "Accredited Person Management", "CHANGE →", "WANT TO CHECK THE NUMBERS FIRST?", "OPEN THE INTERACTIVE CALCULATOR →", "NEXT STEP", "BOOK YOUR HOME INSULATION READY CHECK", "BOOK MY READY CHECK →", "See exactly what’s included on the next page."]) expect(email.html).toContain(copy);
    for (const out of [email.html, email.plainText]) {
      expect(out.split("IT'S LOOKING GOOD SO FAR").length - 1).toBe(1);
      for (const gone of ["YOUR PRELIMINARY ESTIMATE IS READY", "YOU COULD STILL QUALIFY", "could still qualify", "WHAT WE NEED TO CHECK"]) expect(out).not.toContain(gone);
      expect(out.indexOf("IT'S LOOKING GOOD SO FAR")).toBeLessThan(out.indexOf("WE JUST NEED TO CHECK"));
      expect(out.indexOf("Ceiling area — confirm")).toBeLessThan(out.indexOf("YOUR PRELIMINARY QUOTE"));
    }
    expect(email.plainText.indexOf("Ceiling area — confirm")).toBeLessThan(email.plainText.indexOf("PROPERTY"));
    // hero reasons live inside hero; quote card follows directly
    const afterHero = email.html.slice(email.html.indexOf('data-onsite-reasons="true"'));
    expect(afterHero.indexOf('data-main-quote-card="true"')).toBeGreaterThan(0);
    expect(afterHero.slice(0, afterHero.indexOf('data-main-quote-card="true"'))).not.toContain(CUSTOMER_VISUAL_SYSTEM_BORDER);
    const one = renderEstimateEmail({ ...detailed, outcome: "onsite", reasons: ["roof_access_review"] });
    expect(one.html).toContain("WE JUST NEED TO CHECK ONE THING ONSITE:");
    expect(one.plainText).toContain("WE JUST NEED TO CHECK ONE THING ONSITE:");
    const named = renderEstimateEmail({ ...detailed, outcome: "onsite", firstName: "Alex", reasons: ["roof_access_review"] });
    expect(named.html).toContain("IT'S LOOKING GOOD SO FAR, ALEX.");
    for (const safeReason of ["Existing insulation — confirm what is currently installed and whether removal is required.", "Ceiling access — confirm access conditions and whether any access adjustment applies.", "Ceiling area — confirm the measured eligible ceiling area."]) {
      expect(email.html.split(safeReason).length - 1).toBe(1);
      expect(email.plainText.split(safeReason).length - 1).toBe(1);
    }
    for (const internal of ["existing_insulation_unknown", "roof_access_review", "eligible_ceiling_area_unverified", "WHAT WE NEED TO CONFIRM"]) expect(`${email.html} ${email.plainText}`).not.toContain(internal);
    expect(email.html).toContain(`${estimateUrl}#calculator`);
    expect(email.html.split("BOOK MY READY CHECK →").length - 1).toBe(1);
    const onsiteQuote = email.html.slice(email.html.indexOf('data-main-quote-card="true"'), email.html.indexOf("WANT TO CHECK THE NUMBERS FIRST?"));
    expect(onsiteQuote).toContain('data-ready-check-inside-quote="true"');
    expect(onsiteQuote).toContain("BOOK MY READY CHECK →");
    expect(email.html.indexOf("BOOK MY READY CHECK →")).toBeLessThan(email.html.indexOf("WANT TO CHECK THE NUMBERS FIRST?"));
    expect(email.plainText.indexOf("BOOK MY READY CHECK →")).toBeLessThan(email.plainText.indexOf("WANT TO CHECK THE NUMBERS FIRST?"));
    expect(`${email.html} ${email.plainText}`).not.toMatch(/NOT SURE YOUR CEILING SIZE IS RIGHT\?|CHECK ANOTHER CEILING SIZE →/);
    const htmlQuote = email.html.slice(email.html.indexOf("YOUR PRELIMINARY QUOTE"), email.html.indexOf("NEXT STEP"));
    const textQuote = email.plainText.slice(email.plainText.indexOf("YOUR PRELIMINARY QUOTE"), email.plainText.indexOf("NEXT STEP"));
    for (const quote of [htmlQuote, textQuote]) expect(quote).not.toMatch(/\$99 Home Insulation Ready Check — payable now|credited toward your project|Estimated remaining project balance after Ready Check/);
  });

  test("keeps detailed removal guidance off both emails", () => {
    const present = renderEstimateEmail({ ...detailed, outcome: "onsite", existingInsulationPresent: true });
    const absent = renderEstimateEmail({ ...detailed, outcome: "likely", existingInsulationPresent: false });
    expect(present.html).not.toContain(CUSTOMER_EXISTING_INSULATION_NOTE);
    expect(present.plainText).not.toContain(CUSTOMER_EXISTING_INSULATION_NOTE);
    expect(absent.html).not.toContain(CUSTOMER_EXISTING_INSULATION_NOTE);
    expect(absent.plainText).not.toContain(CUSTOMER_EXISTING_INSULATION_NOTE);
  });

  test("preview sample keeps AP management dynamic while only assessment/payable-now are $349", () => {
    const e = renderEstimateEmail({ ...common, estimatedTotal: 3716.24, veuDiscount: 1481.76, areaM2: 150, installationPrice: 4500, assessmentFee: 349, apFee: 349, grossProjectTotal: 5198, amountPayableNow: 99, estimatedRemainingBalance: 3617.24 });
    for (const t of ["$4,500", "$349", "$5,198", "$1,482", "$3,716"]) expect(e.html).toContain(t);
    expect(e.html).not.toContain("$2,361");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    for (const value of ["AP_FEE = 349", "SAMPLE_INSTALL = 4500", "SAMPLE_DISCOUNT = 1481.76", "SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE", "SAMPLE_CUSTOMER = SAMPLE_GROSS - SAMPLE_DISCOUNT", "amountPayableNow: READY_CHECK_FEE"]) expect(preview).toContain(value);
    expect(preview).not.toMatch(/bg-background|text-primary/);
  });

  test("ineligible has dynamic reasons, no available discount, result CTA and referral", () => {
    const resultUrl = `${estimateUrl}#result`;
    const email = withUnsubscribe(renderIneligibleOutcomeEmail({ referralUrl, resultUrl, reasons: ["The home is five years old or newer.", "A previous Activity 48 upgrade was confirmed.", "The home is five years old or newer."], reference: "HV-1003" }), unsubscribeUrl);
    for (const copy of ["WE'VE COMPLETED YOUR PROPERTY CHECK.", "UNFORTUNATELY, THIS PROPERTY DOESN'T APPEAR TO BE ELIGIBLE AT THIS STAGE.", "Based on the information we have, this is because:", "five years old or newer", "previous Activity 48 upgrade", "If any of the information above isn't correct, you can review your details and we'll reassess the result.", "REVIEW MY RESULT →", "KNOW SOMEONE WHO MIGHT QUALIFY?", "REFER A FRIEND →", "They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.", "Reference: HV-1003", "Unsubscribe", "home-insulation-victoria-logo.png"]) expect(email.html).toContain(copy);
    expect(email.html.split("five years old or newer").length - 1).toBe(1);
    expect(email.html).toContain(`href="${resultUrl}"`);
    expect(email.html).not.toMatch(/estimated VEU discount|ESTIMATED CUSTOMER PRICE|PAY \$349|assessment payment available|\$1,325/i);
    expect(email.html).not.toContain("WHY INSULATION MATTERS");
    expect(email.html).not.toContain("COMFORT THROUGH THE SEASONS");
    expect(email.html).not.toContain("THIS PROPERTY DOESN'T CURRENTLY APPEAR ELIGIBLE.");
    for (const copy of ["UNFORTUNATELY, THIS PROPERTY DOESN'T APPEAR TO BE ELIGIBLE AT THIS STAGE.", "Based on the information we have, this is because:", "• The home is five years old or newer.", "• A previous Activity 48 upgrade was confirmed.", "If any of the information above isn't correct, you can review your details and we'll reassess the result.", `REVIEW MY RESULT: ${resultUrl}`]) expect(email.plainText).toContain(copy);
    expect(email.plainText.split("five years old or newer").length - 1).toBe(1);
    expect(email.plainText).not.toMatch(/preliminary quote|payment|\$99|\$349|READY CHECK/i);
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
    expect(() => renderEstimateEmail({ ...detailed, apFee: 850, grossProjectTotal: 5222, estimatedTotal: 3897, estimatedRemainingBalance: 3798 })).not.toThrow();
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
      const indexes = CUSTOMER_QUOTE_ORDER.slice(0, 6).map((label) => email.plainText.indexOf(label));
      expect(indexes.every((index, position) => index >= 0 && (position === 0 || index > indexes[position - 1]!))).toBe(true);
      expect(`${email.html} ${email.plainText}`).not.toMatch(/\bHI VIC\b/);
    }
    const ineligible = renderIneligibleOutcomeEmail({ referralUrl, reasons: ["Fixture reason"] });
    expect(ineligible.html).toContain(CUSTOMER_BRAND.logoUrl);
    expect(ineligible.html).toContain(CUSTOMER_BRAND.font);
    expect(`${ineligible.html} ${ineligible.plainText}`).not.toMatch(/PAY \$349|YOUR PRELIMINARY QUOTE|Estimated project total|\bHI VIC\b/);
  });
});
