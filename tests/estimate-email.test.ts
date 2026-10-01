import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail, renderIneligibleOutcomeEmail, likelySubjectLine } from "../src/lib/estimate-email";
import { withUnsubscribe } from "../src/lib/emailsafety.core";
const CUSTOMER_VISUAL_SYSTEM_BORDER = "border:1px solid #D4DAF5";
import { CUSTOMER_BRAND, CUSTOMER_EXISTING_INSULATION_NOTE, CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_QUOTE_ORDER, CUSTOMER_WHAT_COULD_CHANGE } from "../src/lib/customer-quote-system";

const token = "A".repeat(43);
const estimateUrl = `https://quote.homeinsulationvictoria.com.au/estimate/${token}`;
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${token}`;
const unsubscribeUrl = `https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${token}`;
const common = { estimateUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1, referralUrl, reference: "HV-1001" };
const detailed = { ...common, estimatedTotal: 3747, installationPrice: 4023, assessmentFee: 349, apFee: 700, grossProjectTotal: 5072, amountPayableNow: 0, estimatedRemainingBalance: 3747 };

describe("customer outcome email renderers", () => {
  test("likely eligible: premium proposal order, live savings module, free Ready Check CTA", () => {
    const email = withUnsubscribe(renderEstimateEmail({ ...detailed, outcome: "likely", firstName: "Alex", address: "30 Dash St, Fraser Rise VIC 3336" }), unsubscribeUrl);
    const h = email.html;
    for (const copy of ["Preliminary eligibility result", "Hi Alex,", "A more comfortable home starts here.", "Good news, Alex — based on the information you’ve provided, your home looks likely to qualify for a VEU ceiling insulation discount.", "We’ll coordinate the installer, electrical safety checks and rebate paperwork, so you have one team guiding the process.", "30 Dash St, Fraser Rise VIC 3336", "Your estimated VEU discount", "$1,325", "Estimated cost after discount", "$3,747", "134.1 m² — based on your enquiry", "These are preliminary estimates, subject to eligibility and onsite checks.", "Explore your savings", "What we take care of", "Free measure-up by a certified installer", "Your next step is free.", "A certified insulation installer confirms the ceiling measurements", "Arrange my free Ready Check", "Free Ready Check. No obligation to proceed.", "Your itemised estimate", "Home Insulation Ready Check", "Free", CUSTOMER_QUOTE_LABELS.piesa, "R5.0 ceiling insulation — supply &amp; install", "Home Insulation Victoria — Accredited Person Management", "$5,072", "$700", "−$1,325", CUSTOMER_WHAT_COULD_CHANGE.closing, "All prices include GST.", "Reference: HV-1001", "Refer a friend", "Privacy policy", "Unsubscribe"]) expect(h).toContain(copy);
    const order = ["Preliminary eligibility result", "<h1", "data-likely-savings", "Explore your savings", "What we take care of", "data-likely-next-step", "Arrange my free Ready Check", "data-likely-itemised", "DC Construction Solutions Pty Ltd"].map((t) => h.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
    expect(h.match(/<h1\b/g)?.length).toBe(1);
    expect(h).toContain(`href="${estimateUrl}#confirm"`);
    expect(h).toContain('href="https://estimate.homeinsulationvictoria.com.au/calculator"');
    expect(h).not.toContain("#calculator");
    expect(h).not.toMatch(/<form|<input|<iframe|<script|\son\w+=/i);
    expect(h).toContain('<html lang="en-AU" dir="ltr">');
    expect(h).toContain('<body lang="en-AU" dir="ltr"');
    expect(`${h} ${email.plainText}`).not.toMatch(/undefined|NaN|\$0\b|Gate 1|AP Management|high demand|one of only|guaranteed|energy bill|<div class="hiv-hero-title"/i);
    expect(email.subject).toBe("Alex, your home could qualify for an estimated $1,325 VEU insulation discount");
    for (const t of ["Hi Alex,", "A more comfortable home starts here.", "Your estimated VEU discount: $1,325", "Estimated cost after discount: $3,747", "Explore your savings: https://estimate.homeinsulationvictoria.com.au/calculator", `Arrange my free Ready Check: ${estimateUrl}#confirm`, "Free Ready Check. No obligation to proceed.", "R5.0 ceiling insulation — supply & install: $4,023", "Estimated VEU / VEEC discount: −$1,325", CUSTOMER_WHAT_COULD_CHANGE.intro]) expect(email.plainText).toContain(t);
    expect(email.plainText.indexOf("Explore your savings")).toBeLessThan(email.plainText.indexOf("Arrange my free Ready Check"));
  });

  test("likely eligible fallbacks: typical area, no name, no address, tracked CTA", () => {
    const tracked = `https://quote.homeinsulationvictoria.com.au/t/e/${"T".repeat(43)}`;
    const e = renderEstimateEmail({ ...common, outcome: "likely", areaIsTypical: true, trackingClickUrl: tracked });
    expect(e.html).toContain("Hello,");
    expect(e.html).toContain("Good news — based on the information");
    expect(e.html).not.toContain("Property:");
    expect(e.html).toContain("134.1 m² — based on a typical Victorian home");
    expect(e.html).toContain(`href="${tracked}"`);
    expect(e.html).not.toContain("#confirm");
    expect(e.subject).toBe("Your home could qualify for an estimated $1,325 VEU insulation discount");
    expect(likelySubjectLine(null, null).subject).toBe("Good news — your home looks likely to qualify for a VEU insulation discount");
    expect(likelySubjectLine("Sam", undefined).subject).toBe("Sam, good news — your home looks likely to qualify for a VEU insulation discount");
    expect(likelySubjectLine("Sam", 0).subject).not.toContain("$0");
    expect(`${e.html}${e.plainText}`).not.toMatch(/undefined|NaN/);
    expect(renderEstimateEmail({ ...common, firstName: "<b>x</b>" }).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  test("onsite confirmation remains positive and renders dynamic reasons", () => {
    const email = renderEstimateEmail({ ...detailed, outcome: "onsite", reasons: ["existing_insulation_unknown", "Existing insulation needs confirmation.", "roof_access_review", "eligible_ceiling_area_unverified"] });
    for (const copy of ["IT'S LOOKING GOOD SO FAR.", "WE JUST NEED TO CHECK", "Existing insulation — confirm what is currently installed and whether removal is required.", "Ceiling access — confirm access conditions and whether any access adjustment applies.", "Ceiling area — confirm the measured eligible ceiling area.", "$1,325", "$3,747", CUSTOMER_QUOTE_LABELS.piesa, "Accredited Person Management", "CHANGE →", "WANT TO CHECK THE NUMBERS FIRST?", "OPEN THE INTERACTIVE CALCULATOR →", "NEXT STEP", "BOOK YOUR HOME INSULATION READY CHECK", "BOOK MY READY CHECK →", "See exactly what’s included on the next page."]) expect(email.html).toContain(copy);
    for (const out of [email.html, email.plainText]) {
      expect(out.split("IT'S LOOKING GOOD SO FAR").length - 1).toBe(1);
      for (const gone of ["YOUR PRELIMINARY ESTIMATE IS READY", "YOU COULD STILL QUALIFY", "could still qualify"]) expect(out).not.toContain(gone);
      expect(out.indexOf("IT'S LOOKING GOOD SO FAR")).toBeLessThan(out.indexOf("WE JUST NEED TO CHECK"));
      expect(out.indexOf("Ceiling area — confirm")).toBeLessThan(out.indexOf("YOUR PRELIMINARY QUOTE"));
    }
    expect(email.plainText.indexOf("Ceiling area — confirm")).toBeLessThan(email.plainText.indexOf("PROPERTY"));
    // hero reasons live inside hero; quote card follows directly
    const afterHero = email.html.slice(email.html.indexOf('data-onsite-reasons="true"'));
    expect(afterHero.indexOf('data-main-quote-card="true"')).toBeGreaterThan(0);
    expect(afterHero.slice(0, afterHero.indexOf('data-main-quote-card="true"'))).not.toContain(CUSTOMER_VISUAL_SYSTEM_BORDER);
    const one = renderEstimateEmail({ ...detailed, outcome: "onsite", reasons: ["roof_access_review"] });
    expect(one.html).toContain("WE JUST NEED TO CHECK");
    expect(one.plainText).toContain("WE JUST NEED TO CHECK");
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

  test("preview sample keeps AP management dynamic while the Ready Check is free", () => {
    const e = renderEstimateEmail({ ...common, estimatedTotal: 3716.24, veuDiscount: 1481.76, areaM2: 150, installationPrice: 4500, assessmentFee: 349, apFee: 349, grossProjectTotal: 5198, amountPayableNow: 0, estimatedRemainingBalance: 3716.24 });
    for (const t of ["$4,500", "$349", "$5,198", "$1,482", "$3,716"]) expect(e.html).toContain(t);
    expect(e.html).not.toContain("$2,361");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    for (const value of ["AP_FEE = 349", "SAMPLE_INSTALL = 4500", "SAMPLE_DISCOUNT = 1481.76", "SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE", "SAMPLE_CUSTOMER = SAMPLE_GROSS - SAMPLE_DISCOUNT", "amountPayableNow: 0"]) expect(preview).toContain(value);
    expect(preview).not.toMatch(/bg-background|text-primary/);
  });

  test("ineligible has dynamic reasons, no available discount, result CTA and referral", () => {
    const resultUrl = `${estimateUrl}#result`;
    const email = withUnsubscribe(renderIneligibleOutcomeEmail({ referralUrl, resultUrl, reasons: ["The home is five years old or newer.", "A previous Activity 48 upgrade was confirmed.", "The home is five years old or newer."], reference: "HV-1003" }), unsubscribeUrl);
    for (const copy of ["WE'VE COMPLETED YOUR PROPERTY CHECK.", "UNFORTUNATELY, THIS PROPERTY DOESN'T APPEAR TO BE ELIGIBLE AT THIS STAGE", "Based on the information we have, this is because:", "five years old or newer", "previous Activity 48 upgrade", "If any of the information you entered was incorrect, you can review and update your answers. We will reassess the result using the corrected information.", "REVIEW MY RESULT →", "KNOW SOMEONE WHO MIGHT QUALIFY?", "REFER A FRIEND →", "They’ll enter their own Victorian property address and details so we can check their eligibility and calculate an estimate using the correct local VEU settings.", "Reference: HV-1003", "Unsubscribe", "home-insulation-victoria-logo.png"]) expect(email.html).toContain(copy);
    expect(email.html.split("five years old or newer").length - 1).toBe(1);
    expect(email.html).toContain(`href="${resultUrl}"`);
    expect(email.html).not.toMatch(/estimated VEU discount|ESTIMATED CUSTOMER PRICE|PAY \$349|assessment payment available|\$1,325/i);
    expect(email.html).not.toContain("WHY INSULATION MATTERS");
    expect(email.html).not.toContain("COMFORT THROUGH THE SEASONS");
    expect(email.html).not.toContain("THIS PROPERTY DOESN'T CURRENTLY APPEAR ELIGIBLE.");
    for (const copy of ["UNFORTUNATELY, THIS PROPERTY DOESN'T APPEAR TO BE ELIGIBLE AT THIS STAGE", "Based on the information we have, this is because:", "• The home is five years old or newer.", "• A previous Activity 48 upgrade was confirmed.", "If any of the information you entered was incorrect, you can review and update your answers. We will reassess the result using the corrected information.", `REVIEW MY RESULT: ${resultUrl}`]) expect(email.plainText).toContain(copy);
    expect(email.plainText.split("five years old or newer").length - 1).toBe(1);
    expect(email.plainText).not.toMatch(/preliminary quote|payment|\$99|\$349|READY CHECK/i);
    expect(() => renderIneligibleOutcomeEmail({ referralUrl, resultUrl: `${estimateUrl}#confirm`, reasons: ["No"] })).toThrow();
  });

  test("AP count never appears in likely; onsite keeps verified wording", () => {
    expect(renderEstimateEmail({ ...common, apCount: 7 }).html).not.toMatch(/one of only/i);
    const verified = renderEstimateEmail({ ...common, outcome: "onsite", apCount: 7 });
    expect(verified.html).toContain("ONE OF ONLY 7 ACCREDITED PERSONS CURRENTLY APPROVED FOR ACTIVITY 48 IN VICTORIA");
    for (const email of [verified, renderIneligibleOutcomeEmail({ referralUrl })]) expect(`${email.html} ${email.plainText}`).not.toMatch(/team member|staff/i);
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
    expect(() => renderEstimateEmail({ ...detailed, apFee: 850, grossProjectTotal: 5222, estimatedTotal: 3897, estimatedRemainingBalance: 3897 })).not.toThrow();
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
    expect(likely).toContain("fonts.googleapis.com/css2?family=Open+Sans:wght@400;600;700;800");
    expect(likely).toContain("<!--[if !mso]><!-->");
    expect(likely).toContain("<!--[if mso]>");
    expect(likely).toContain("@media only screen and (max-width:480px)");
    expect(source + preview).not.toMatch(/sendTemplateEmail|sendLovableEmail|createServerFn|supabase|fetch\(|\.insert\(|\.update\(/);
    expect(preview).toContain("Likely eligible");
    expect(preview).toContain("Test OPEN THE INTERACTIVE CALCULATOR →");
    expect(preview).toContain("Test REVIEW MY RESULT →");
    expect(preview).toContain("640 desktop");
    expect(preview).toContain("390 mobile");
  });

  test("shares the canonical brand and quote order across eligible outcomes", () => {
    expect(CUSTOMER_BRAND).toEqual({ name: "Home Insulation Victoria", logoUrl: "https://homeinsulationvictoria.com.au/home-insulation-victoria-logo.png", colors: { blue: "#3C51C4", green: "#07BF61", accent: "#52C875", offWhite: "#FBFCFA", navy: "#22376B", white: "#FFFFFF" }, font: "'Open Sans',Arial,Helvetica,sans-serif" });
    for (const outcome of ["likely", "onsite"] as const) {
      const email = renderEstimateEmail({ ...detailed, outcome });
      const indexes = CUSTOMER_QUOTE_ORDER.slice(0, outcome === "likely" ? 5 : 6).map((label) => email.plainText.indexOf(label));
      expect(indexes.every((index, position) => index >= 0 && (position === 0 || index > indexes[position - 1]!))).toBe(true);
      expect(`${email.html} ${email.plainText}`).not.toMatch(/\bHI VIC\b/);
    }
    const ineligible = renderIneligibleOutcomeEmail({ referralUrl, reasons: ["Fixture reason"] });
    expect(ineligible.html).toContain(CUSTOMER_BRAND.logoUrl);
    expect(ineligible.html).toContain(CUSTOMER_BRAND.font);
    expect(`${ineligible.html} ${ineligible.plainText}`).not.toMatch(/PAY \$349|YOUR PRELIMINARY QUOTE|Estimated project total|\bHI VIC\b/);
  });
});

import { describe as d2, it as i2, expect as e2 } from "bun:test";
import { CUSTOMER_APPROVAL_REASSURANCE as CAR, CUSTOMER_WHAT_COULD_CHANGE as WCC, CUSTOMER_INELIGIBLE_COPY as ICP } from "../src/lib/customer-quote-system";
d2("copy normalisation", () => {
  i2("one reassurance, kinder ineligible copy", () => {
    e2(WCC.closing).toBe(CAR);
    e2(ICP.intro).toBe("Based on the information we have, this is because:");
    e2(ICP.cta).toBe("REVIEW MY RESULT →");
    e2("reasonsHeading" in ICP).toBe(false);
  });
});
