import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderEstimateEmail, renderIneligibleOutcomeEmail, renderLaunchCampaignEmail, likelySubjectLine, renderSaveSpotFromLikelyEmail } from "../src/lib/estimate-email";
import { withUnsubscribe } from "../src/lib/emailsafety.core";
import { INSTALLER_INVITATION_HTML } from "../src/lib/installer-invitation.html";
const CUSTOMER_VISUAL_SYSTEM_BORDER = "border:1px solid #D4DAF5";
import { CUSTOMER_BRAND, CUSTOMER_EXISTING_INSULATION_NOTE, CUSTOMER_PAYMENT_COPY, CUSTOMER_QUOTE_LABELS, CUSTOMER_QUOTE_ORDER, CUSTOMER_WHAT_COULD_CHANGE } from "../src/lib/customer-quote-system";

const token = "A".repeat(43);
const estimateUrl = `https://estimate.homeinsulationvictoria.com.au/estimate/${token}`;
const referralUrl = `https://homeinsulationvictoria.com.au/homeowner?ref=${token}`;
const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${token}`;
const common = { estimateUrl, estimatedTotal: 3396, veuDiscount: 1325, areaM2: 134.1, referralUrl, reference: "HV-1001" };
const detailed = { ...common, estimatedTotal: 3747, installationPrice: 4023, assessmentFee: 349, apFee: 700, grossProjectTotal: 5072, amountPayableNow: 0, estimatedRemainingBalance: 3747 };

describe("customer outcome email renderers", () => {
  test("likely eligible: approved single-column result and refined supporting sections", () => {
    const email = withUnsubscribe(renderEstimateEmail({ ...detailed, outcome: "likely", firstName: "Alex", address: "30 Dash St, Fraser Rise VIC 3336" }), unsubscribeUrl);
    const h = email.html;
    for (const copy of ["Free estimate · no obligation", "Preliminary eligibility result", "How much could you save on ceiling insulation?", "Good news, Alex — based on what you’ve told us", "A more comfortable home could be closer than you think.", "What this includes", "Free Ready Check", "We measure your ceiling, assess whether any existing insulation can stay or needs removal, and confirm eligibility and the job scope.", "FREE", "R5.0 ceiling insulation — supply &amp; install", "Certified Insulation Installer (CII)", "Pre Insulation Electrical Safety Assessment (PIESA)", "pre-vetted REC electrician", "Accredited Person (AP) management", "Demand is high. Installer availability is limited.", "30 Dash St, Fraser Rise VIC 3336", "Your estimated VEU rebate", "You could save $1,325", "Your estimated cost after rebate", "$3,747", "incl. GST · before rebate $5,072", "Free Ready Check", "Your installer measures the ceiling, assesses any existing insulation, confirms eligibility and prepares the job scope so we can confirm your quote.", "Arrange my free Ready Check →", "Confirm your request on the next page. An installer from our panel will then contact you to arrange a time.", "No payment required. No obligation to proceed with installation.", "What could change this price?", "Final measured ceiling size", "electrical fixes identified during PIESA", CUSTOMER_WHAT_COULD_CHANGE.closing, "Open&nbsp;the&nbsp;calculator&nbsp;→", "Reference: HV-1001", "Refer a friend", "Privacy", "Unsubscribe"]) expect(h).toContain(copy);
    expect(`${h} ${email.plainText}`).not.toMatch(/measure-up (?:&amp;|&) eligibility check/i);
    const order = ["<h1", "data-likely-savings", "data-likely-calculator", "data-likely-itemised", "data-likely-next-step", "What could change this price?", "DC Construction Solutions Pty Ltd"].map((t) => h.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
    expect(h.match(/<h1\b/g)?.length).toBe(1);
    expect(h).toContain(`href="${estimateUrl}#confirm"`);
    expect(h).toContain('href="https://estimate.homeinsulationvictoria.com.au/"');
    expect(h).not.toContain("#calculator");
    expect(h.split(`href="${unsubscribeUrl}"`).length - 1).toBe(1);
    expect(h).not.toContain("A secure unsubscribe link appears below");
    expect(email.plainText).not.toContain("A secure unsubscribe link appears below");
    expect(h).not.toMatch(/<form|<input|<iframe|<script|\son\w+=/i);
    expect(`${h} ${email.plainText}`).not.toMatch(/undefined|NaN|\$0\b|Gate 1|guaranteed|energy bill/i);
    expect(email.subject).toBe("Alex, you could save $1,325 on ceiling insulation");
    for (const t of ["How much could you save on ceiling insulation?", "Your estimated VEU rebate: You could save $1,325", "Your estimated cost after rebate: $3,747", "✓ Free Ready Check: FREE", "We measure your ceiling, assess whether any existing insulation can stay or needs removal, and confirm eligibility and the job scope.", "R5.0 ceiling insulation — supply & install: $4,023", "Pre Insulation Electrical Safety Assessment (PIESA): $349", "Accredited Person (AP) management: $700", "FREE READY CHECK", "Your installer measures the ceiling, assesses any existing insulation, confirms eligibility and prepares the job scope so we can confirm your quote.", "Demand is high. Installer availability is limited.", `Arrange my free Ready Check: ${estimateUrl}#confirm`, "Confirm your request on the next page. An installer from our panel will then contact you to arrange a time.", "No payment required. No obligation to proceed with installation.", "• Final measured ceiling size", "Want to explore a different ceiling size? Open the calculator: https://estimate.homeinsulationvictoria.com.au/"]) expect(email.plainText).toContain(t);
  });

  test("likely eligible fallbacks: typical area, no name, no address, tracked CTA", () => {
    const tracked = `https://estimate.homeinsulationvictoria.com.au/t/e/${"T".repeat(43)}`;
    const e = renderEstimateEmail({ ...common, outcome: "likely", areaIsTypical: true, trackingClickUrl: tracked });
    expect(e.html).toContain("Good news — based on what you’ve told us, your home looks likely to qualify for a VEU ceiling insulation rebate.");
    expect(e.html).not.toContain("Property:");
    expect(e.html).toContain("134.1 m² (typical-home assumption)");
    expect(e.html).toContain(`href="${tracked}"`);
    expect(e.html).not.toContain("#confirm");
    expect(e.subject).toBe("You could save $1,325 on ceiling insulation");
    expect(likelySubjectLine(null, null).subject).toBe("Your preliminary ceiling insulation estimate is ready");
    expect(likelySubjectLine("Sam", undefined).subject).toBe("Sam, your preliminary ceiling insulation estimate is ready");
    expect(likelySubjectLine("Sam", 0).subject).not.toContain("$0");
    expect(`${e.html}${e.plainText}`).not.toMatch(/undefined|NaN/);
    expect(renderEstimateEmail({ ...common, firstName: "<b>x</b>" }).html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });

  test("likely eligible AP count is conditional (business-supplied figure)", () => {
    const withCount = renderEstimateEmail({ ...common, outcome: "likely", apCount: 2 });
    expect(withCount.html).toContain("We’re one of only two Accredited Persons approved for VEU ceiling insulation in Victoria.");
    expect(withCount.plainText).toContain("We’re one of only two Accredited Persons approved for VEU ceiling insulation in Victoria.");
    const without = renderEstimateEmail({ ...common, outcome: "likely" });
    expect(without.html).not.toMatch(/One of only/i);
    expect(without.plainText).not.toMatch(/One of only/i);
  });

  test("onsite confirmation uses the approved design and renders dynamic reasons once", () => {
    const email = withUnsubscribe(renderEstimateEmail({ ...detailed, outcome: "onsite", address: "30 Dash St, Fraser Rise VIC 3336", reasons: ["existing_insulation_unknown", "Existing insulation needs confirmation.", "roof_access_review", "eligible_ceiling_area_unverified"] }), unsubscribeUrl);
    const h = email.html;
    for (const copy of ["Your insulation estimate — a few details to confirm", "It’s looking good — let’s check a few details", "Your home may qualify for a VEU ceiling insulation rebate. We just need to confirm a few details onsite.", "What we need to confirm", "Your potential VEU rebate", "You could save $1,325", "Estimated cost if eligible", "$3,747", "Indicative estimate only. Eligibility, ceiling measurements and final pricing still need to be confirmed.", "Open&nbsp;the&nbsp;calculator&nbsp;→", "Free Ready Check", "R5.0 ceiling insulation — supply &amp; install", "Pre Insulation Electrical Safety Assessment (PIESA)", "Accredited Person (AP) management", "Arrange my free Ready Check →", "Demand is high. Installer availability is limited.", "No payment required. No obligation to proceed with installation.", "What could change this price?", CUSTOMER_WHAT_COULD_CHANGE.closing, "Unsubscribe"]) expect(`${email.subject} ${h}`).toContain(copy);
    for (const safeReason of ["Existing insulation — confirm what is currently installed and whether removal is required.", "Ceiling access — confirm access conditions and whether any access adjustment applies.", "Ceiling area — confirm the measured eligible ceiling area."]) {
      expect(h.split(safeReason).length - 1).toBe(1);
      expect(email.plainText.split(safeReason).length - 1).toBe(1);
    }
    for (const internal of ["existing_insulation_unknown", "roof_access_review", "eligible_ceiling_area_unverified"]) expect(`${h} ${email.plainText}`).not.toContain(internal);
    expect(`${h} ${email.plainText}`).not.toMatch(/your home qualifies|Arrange my free check|A secure unsubscribe link appears below/i);
    const order = ["<h1", "data-onsite-reasons", "data-likely-savings", "data-likely-calculator", "data-likely-itemised", "data-likely-next-step", "What could change this price?", "DC Construction Solutions Pty Ltd"].map((t) => h.indexOf(t));
    expect(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
    expect(h.match(/<h1\b/g)?.length).toBe(1);
    expect(h).toContain(`href="${estimateUrl}#confirm"`);
    expect(h.split('href="https://estimate.homeinsulationvictoria.com.au/"').length - 1).toBe(1);
    expect(h.split(`href="${unsubscribeUrl}"`).length - 1).toBe(1);
    const named = renderEstimateEmail({ ...detailed, outcome: "onsite", firstName: "Alex", reasons: [] });
    expect(named.html).toContain("Alex, your home may qualify");
    expect(named.html).toContain("A few property details that can only be confirmed onsite");
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
    for (const t of ["$5,198", "$1,482", "$3,716"]) expect(e.html).toContain(t);
    for (const t of ["$4,500", "$349"]) expect(e.html).toContain(t);
    expect(e.html).not.toContain("$2,361");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    const sample = readFileSync("src/lib/step3-email-samples.ts", "utf8");
    for (const value of ["AP_FEE = 349", "SAMPLE_INSTALL = 4500", "SAMPLE_DISCOUNT = 1481.76", "SAMPLE_GROSS = SAMPLE_INSTALL + PIESA_FEE + AP_FEE", "SAMPLE_CUSTOMER = SAMPLE_GROSS - SAMPLE_DISCOUNT", "amountPayableNow: 0"]) expect(sample).toContain(value);
    expect(preview).not.toMatch(/bg-background|text-primary/);
  });

  test("ineligible has dynamic reasons, no available discount, result CTA and referral", () => {
    const resultUrl = `${estimateUrl}#result`;
    const email = withUnsubscribe(renderIneligibleOutcomeEmail({ referralUrl, resultUrl, reasons: ["The home is five years old or newer.", "A previous Activity 48 upgrade was confirmed.", "The home is five years old or newer."], reference: "HV-1003" }), unsubscribeUrl);
    for (const copy of ["Eligibility result", "Preliminary eligibility result", "Your ceiling insulation eligibility result", "this property doesn’t appear eligible for a VEU ceiling insulation rebate at this stage.", "What we found", "five years old or newer", "previous Activity 48 upgrade", "Something doesn’t look right?", "If any details are incorrect, review your result or contact us so we can check them.", "Review my result →", "Know someone else thinking about ceiling insulation? They can check their own eligibility.", "Refer&nbsp;a&nbsp;friend&nbsp;→", "For eligible upgrades", "Reference: HV-1003", "Unsubscribe", "home-insulation-victoria-logo.png"]) expect(email.html).toContain(copy);
    expect(email.html.split("five years old or newer").length - 1).toBe(1);
    expect(email.html).toContain(`href="${resultUrl}"`);
    expect(email.html).toContain(`href="${referralUrl}"`);
    expect(email.html.split(`href="${unsubscribeUrl}"`).length - 1).toBe(1);
    expect(email.html).not.toMatch(/You could save|cost after rebate|PAY \$349|\$1,325|Demand is high|Arrange my free|✓/i);
    for (const copy of ["• The home is five years old or newer.", "• A previous Activity 48 upgrade was confirmed.", `Review my result: ${resultUrl}`, `Refer a friend: ${referralUrl}`]) expect(email.plainText).toContain(copy);
    expect(email.plainText.split("five years old or newer").length - 1).toBe(1);
    expect(email.plainText).not.toMatch(/preliminary quote|payment|\$99|\$349|READY CHECK|appears below/i);
    expect(renderIneligibleOutcomeEmail({ referralUrl }).html).toContain("doesn’t meet the current requirements");
    expect(() => renderIneligibleOutcomeEmail({ referralUrl, resultUrl: `${estimateUrl}#confirm`, reasons: ["No"] })).toThrow();
  });

  test("AP count is conditional in likely; onsite keeps verified wording", () => {
    expect(renderEstimateEmail({ ...common, outcome: "likely", apCount: 7 }).html).toContain("We’re one of only 7 Accredited Persons approved for VEU ceiling insulation in Victoria.");
    expect(renderEstimateEmail({ ...common, outcome: "likely" }).html).not.toMatch(/one of only/i);
    const verified = renderEstimateEmail({ ...detailed, outcome: "onsite", apCount: 7 });
    expect(verified.html).toContain("We’re one of only 7 Accredited Persons approved for VEU ceiling insulation in Victoria.");
    expect(renderEstimateEmail({ ...detailed, outcome: "onsite" }).html).not.toMatch(/one of only/i);
    expect(renderIneligibleOutcomeEmail({ referralUrl, apCount: 2 }).html).not.toMatch(/one of only/i);
    for (const email of [verified, renderIneligibleOutcomeEmail({ referralUrl })]) expect(`${email.html} ${email.plainText}`).not.toMatch(/team member|staff/i);
  });

  test("requires all mandatory quote values and rejects unsafe URLs", () => {
    expect(() => renderEstimateEmail({ estimateUrl, estimatedTotal: 3396, veuDiscount: 1325 })).toThrow();
    expect(() => renderEstimateEmail({ ...common, estimateUrl: "https://evil.example/estimate/x" })).toThrow();
    expect(() => renderIneligibleOutcomeEmail({ referralUrl: "https://evil.example/x", reasons: ["No"] })).toThrow();
  });

  test("validates detailed quote arithmetic and never fabricates missing line items", () => {
    const email = renderEstimateEmail(detailed);
    expect(email.plainText).toContain("R5.0 ceiling insulation — supply & install");
    expect(renderEstimateEmail(common).html).not.toContain("Accredited Person Management");
    expect(() => renderEstimateEmail({ ...detailed, grossProjectTotal: 5000 })).toThrow();
    expect(() => renderEstimateEmail({ ...detailed, estimatedRemainingBalance: 3000 })).toThrow();
    expect(() => renderEstimateEmail({ ...detailed, apFee: 850, grossProjectTotal: 5222, estimatedTotal: 3897, estimatedRemainingBalance: 3897 })).not.toThrow();
    expect(() => renderEstimateEmail({ ...detailed, assessmentFee: 350, grossProjectTotal: 5073, estimatedTotal: 3748, estimatedRemainingBalance: 3399 })).toThrow();
    expect(() => renderEstimateEmail({ ...common, assessmentFee: 349 })).toThrow();
    expect(`${email.html} ${email.plainText}`).not.toContain("Pleased to meet you");
  });

  test("uses email-safe markup, loads calculator fonts for likely, and remains a pure renderer", () => {
    const source = readFileSync("src/lib/estimate-email.ts", "utf8");
    const preview = readFileSync("src/routes/step3-email-preview.tsx", "utf8");
    for (const email of [renderEstimateEmail(common), renderIneligibleOutcomeEmail({ referralUrl, reasons: ["Fixture reason"] })]) {
      expect(email.html).not.toMatch(/<script\b|\son\w+=/i);
      expect(email.html).toContain("max-width:640px");
      for (const colour of ["#3C51C4", "#07BF61"]) expect(email.html).toContain(colour);
    }
    const likely = renderEstimateEmail(common).html;
    const ineligible = renderIneligibleOutcomeEmail({ referralUrl, reasons: ["Fixture reason"] }).html;
    expect(likely).toContain("font-family:'Figtree',Arial,Helvetica,sans-serif");
    expect(ineligible).toContain("font-family:'Figtree',Arial,Helvetica,sans-serif");
    expect(likely).toContain("family=Figtree:wght@400;600;700;800&amp;family=Outfit:wght@700;800");
    expect(likely).toContain("font-family:'Outfit','Figtree',Arial,Helvetica,sans-serif");
    expect(likely).toContain("<!--[if !mso]><!-->");
    expect(likely).toContain("<!--[if mso]>");
    expect(likely).toContain("@media only screen and (max-width:480px)");
    expect(source + preview).not.toMatch(/sendTemplateEmail|sendLovableEmail|createServerFn|supabase|fetch\(|\.insert\(|\.update\(/);
    expect(preview).toContain("Likely eligible");
    expect(preview).toContain("Test Open the calculator →");
    expect(preview).toContain("Test Review my result →");
    expect(preview).toContain("640 desktop");
    expect(preview).toContain("390 mobile");
  });

  test("shares the canonical brand and quote order across eligible outcomes", () => {
    expect(CUSTOMER_BRAND).toEqual({ name: "Home Insulation Victoria", logoUrl: "https://homeinsulationvictoria.com.au/home-insulation-victoria-logo.png", colors: { blue: "#3C51C4", green: "#07BF61", accent: "#52C875", offWhite: "#FBFCFA", navy: "#22376B", white: "#FFFFFF" }, font: "'Open Sans',Arial,Helvetica,sans-serif" });
    for (const outcome of ["likely", "onsite"] as const) {
      const email = renderEstimateEmail({ ...detailed, outcome });
      const quoteText = email.plainText;
      const labels = ["R5.0 ceiling insulation", "Pre Insulation Electrical Safety Assessment (PIESA)", "Accredited Person (AP) management"];
      const indexes = labels.map((label) => quoteText.indexOf(label));
      expect(indexes.every((index, position) => index >= 0 && (position === 0 || index > indexes[position - 1]!))).toBe(true);
      expect(`${email.html} ${email.plainText}`).not.toMatch(/\bHI VIC\b/);
    }
    const ineligible = renderIneligibleOutcomeEmail({ referralUrl, reasons: ["Fixture reason"] });
    expect(ineligible.html).toContain(CUSTOMER_BRAND.logoUrl);
    expect(ineligible.html).toContain("'Outfit','Figtree'");
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

const CAMPAIGN_BANNED = ["VEU rebate", "You could save", "PIESA", "REC", "CII", "Accredited Person (AP)", "VEECs ×", "Open the calculator", "incl. GST · before rebate", "What this includes"];
describe("launch campaign email drafts", () => {
  const campaignUrl = `https://estimate.homeinsulationvictoria.com.au/estimate/${token}/campaign`;
  const unsubscribeUrl = `https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=${token}`;

  test.skip("RETIRED by Jo 7 Oct — v9 Group A reuses the partner invitation template shell verbatim with live price rows", () => {
    const email = renderLaunchCampaignEmail({ group: "likely", campaignUrl, unsubscribeUrl, firstName: "Sarah", estimatedTotal: 3728, veuDiscount: 1470, grossTotal: 5198, areaM2: 150, address: "14 Example Street, Ballarat VIC 3350", insulation: "none", reference: "HV-1" });
    expect(email.subject).toBe("Great news, Sarah! $1,470 off your ceiling insulation 🎉");
    expect(email.previewText).toBe("Save your spot in one tap. Installers are booking up fast.");
    const tpl = INSTALLER_INVITATION_HTML;
    const logoRow = tpl.slice(tpl.indexOf('<tr><td style="height:5px'), tpl.indexOf("TRADE<br>PARTNERS"));
    expect(email.html).toContain(logoRow);
    expect(email.html).toContain(tpl.slice(0, tpl.indexOf("<title>")));
    expect(email.html).toContain("DC Construction Solutions Pty Ltd<br>ABN 44 671 613 979<br>Trading as Home Insulation Victoria");
    for (const text of ["Great news, Sarah!", "Your Ballarat home looks eligible for the Victorian Energy Upgrades rebate.", "Ceiling insulation (150 m²)", "$4,500", "Pre Insulation Electrical Safety Assessment (PIESA)", "Accredited Person fee", "VEU rebate", "−$1,470", "You pay about", "$3,728", "FREE", "Free Ready Check", "Save my spot →", "Free · no payment · no obligation", "Privacy", "Remove my enquiry"]) expect(email.html).toContain(text);
    expect(email.html).toContain(`href="${campaignUrl}"`);
    expect(email.html).toContain('href="https://estimate.homeinsulationvictoria.com.au/privacy"');
    for (const text of ["TRADE<br>PARTNERS", "partnership invitations", "email-art", "Saving your spot does not book a visit", "TEST — only sent to Jo"]) expect(email.html).not.toContain(text);
    expect(email.html.match(/<img /g)?.length).toBe(1);
  });
  test("Group B: approved Group A layout with preliminary estimate and office-first insulation invitation", () => {
    const email = renderLaunchCampaignEmail({ group: "onsite", campaignUrl, unsubscribeUrl, firstName: "Michael", estimatedTotal: 3379, veuDiscount: 1470, grossTotal: 4849, areaM2: 150, address: "28 Sample Road, Bendigo VIC 3550" });
    expect(email.subject).toBe("Michael — your preliminary insulation estimate");
    for (const text of ["your home could qualify", "JUMP THE QUEUE", "below R2", "Our office will assess", "$3,379", "$1,470", "data-likely-savings", "data-likely-itemised", "What could change this price?"]) expect(email.html).toContain(text);
    for (const text of ["installer capacity is limited", "behind eligible homes", "move you into the eligible queue", "save your spot", "Send my insulation details", "Please budget $15 per m² including GST for the areas that need removal only", "confirm the area and cost before you approve any removal"]) {
      expect(email.html).toContain(text);
      expect(email.plainText).toContain(text);
    }
    expect(email.html).toContain(`href="${campaignUrl.replace(/\/campaign$/, "/video")}"`);
    expect(email.html).not.toContain("Save my spot →");
  });

});

describe("Save your spot (likely eligible) duplicate", () => {
  const SAVE_SPOT_COPY = "We have been inundated with requests from owners all over Victoria. As one of only two Accredited Persons for this activity, and with limited capacity of suitably qualified installers, we need to take on approvals in batches. Save your spot to join the line and we will be in touch as soon as the next installer is available in your area.";
  const LIKELY_HERO = "A more comfortable home could be closer than you think. We’ll coordinate the installer, electrical checks and paperwork.";
  const SAVE_SPOT_HERO = "We organise everything for you: a certified installer, the licensed electrician’s Pre Insulation Electrical Safety Assessment (PIESA) and all the rebate paperwork. No hunting for eligible trades, and no juggling multiple quotes and appointments. One team, one price, start to finish.";
  const campaign = "https://estimate.homeinsulationvictoria.com.au/campaign/" + "C".repeat(43);
  const input = { ...detailed, outcome: "likely" as const, firstName: "Alex", address: "30 Dash St, Fraser Rise VIC 3336" };
  test("pink box: heading, Jo's new paragraph and button only; small lines and the rest of the email unchanged", () => {
    const email = renderSaveSpotFromLikelyEmail({ ...input, campaignUrl: campaign });
    const card = email.html.match(/<table data-likely-next-step="true"[\s\S]*?No obligation to proceed with installation\.<\/p><\/td><\/tr><\/table>/)?.[0] ?? "";
    for (const copy of ["Save your spot", SAVE_SPOT_COPY, "Save my spot →", `href="${campaign}"`, "Demand is high. Installer availability is limited.", "We will be in touch to book your free Ready Check as soon as we can.", "No payment required. No obligation to proceed with installation."]) expect(card).toContain(copy);
    for (const retired of ["Your installer measures the ceiling", "Free Ready Check", "Arrange my free Ready Check →", "Confirm your request on the next page. An installer from our panel will then contact you to arrange a time."]) expect(card).not.toContain(retired);
    const text = email.plainText;
    expect(text).toContain(`SAVE YOUR SPOT\n${SAVE_SPOT_COPY}\n`);
    expect(text).toContain(`Save my spot: ${campaign}`);
    expect(text).toContain("Demand is high. Installer availability is limited.");
    expect(text).toContain("We will be in touch to book your free Ready Check as soon as we can.");
    expect(text).not.toContain("Confirm your request on the next page. An installer from our panel will then contact you to arrange a time.");
    expect(text).toContain("No payment required. No obligation to proceed with installation.");
    expect(text).not.toContain("Your installer measures the ceiling");
    const base = renderEstimateEmail(input);
    expect(email.subject).toBe(base.subject);
    expect(email.previewText).toBe(base.previewText);
    // Jo, 7 Oct 17:27 UTC: hero is the same as the likely email; only the four pink-box swaps.
    expect(email.html).not.toContain(SAVE_SPOT_HERO);
    expect(email.html).toContain(LIKELY_HERO);
    expect(text).toContain(LIKELY_HERO);
    expect(base.html).toContain(LIKELY_HERO);
    expect(base.plainText).toContain(LIKELY_HERO);
    expect(email.html.replace(card, "")).toBe(base.html.replace(/<table data-likely-next-step="true"[\s\S]*?No obligation to proceed with installation\.<\/p><\/td><\/tr><\/table>/, ""));
  });
});

describe("Group A header image", () => {
  test("renders a 1062px-wide (354 at 3x, phone-first) PNG for short, long and missing names", async () => {
    const { renderEmailHeroPng } = await import("../src/lib/email-hero.core");
    for (const [n, r] of [["Jo", "$1,120"], ["Christopher", "$12,250"], [null, "$1,890"]] as const) {
      const png = renderEmailHeroPng(n, r);
      expect(Array.from(png.slice(1, 4))).toEqual([80, 78, 71]);
      expect(new DataView(png.buffer, png.byteOffset).getUint32(16)).toBe(1062);
    }
  });
});

import { HEADING_ART } from "../src/lib/email-art.core";
import { measureHeading } from "../src/lib/email-hero.core";
test("v7 heading art sizes match the bundled fonts", () => {
  for (const a of Object.values(HEADING_ART)) expect(measureHeading(a.text, a.style)).toEqual({ w: a.w, h: a.h });
});
