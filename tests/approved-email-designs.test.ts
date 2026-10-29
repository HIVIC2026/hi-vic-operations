// Decision 137 (Jo 24 Oct 2026), refreshed by the MJML email designs Jo approved 27 Oct 2026 (docs/templates/mjml/*.mjml):
// every email renderer produces its approved design through the shared `mjEmail` frame (src/lib/mail-mjml.core.ts).
// Each renderer is rendered with sample data and checked for its headline, amounts, button label, the 30-day box where
// applicable, the shared frame, and the absence of retired wording. Pure: no I/O beyond reading the design files, nothing sent.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { FOOTER_TEXT } from "../src/lib/email-kit.core";
import { MAIL_LOGO_URL } from "../src/lib/mail-mjml.core";
import { renderMjml } from "../src/lib/mjml-lite.core";
import { renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";
import { renderCoverageUnavailableEmail } from "../src/lib/coverage-email";
import { renderSpotSavedEmail } from "../src/lib/spot-saved-messages.core";
import { renderReadyCheckTimesEmail, READY_CHECK_TIMES_EMAIL_APPROVED } from "../src/lib/ready-check-times-email.core";
import { renderReadyCheckBookedEmail, READY_CHECK_BOOKED_EMAIL_APPROVED } from "../src/lib/ready-check-booked-email.core";
import { renderOwnerQuoteEmail, renderQuoteReminderEmail, OWNER_QUOTE_EMAIL_APPROVED, QUOTE_REMINDER_EMAIL_APPROVED } from "../src/lib/owner-quote-email.core";
import { renderYoureInEmail, ACCEPTANCE_EMAIL_APPROVED } from "../src/lib/acceptance-email.core";
import { renderSafetyCheckTimesEmail, renderSafetyCheckBookedEmail, SAFETY_CHECK_EMAILS_APPROVED } from "../src/lib/safety-check-emails.core";
import { renderFixesQuoteEmail, FIXES_QUOTE_EMAIL_APPROVED } from "../src/lib/rectification-quote-email.core";
import { renderPiesaCopyEmail, PIESA_COPY_EMAIL_APPROVED } from "../src/lib/piesa-delivery.core";
import { renderInstallDaysEmail, renderInstallDayChangedEmail, INSTALL_DAYS_EMAIL_APPROVED } from "../src/lib/install-days-email.core";
import { renderInstallBookedEmail, INSTALL_BOOKED_EMAIL_APPROVED } from "../src/lib/install-booked-email.core";
import { renderInstallCompleteEmail, renderFinalInvoiceEmail, renderCompletionPackEmail, renderReviewRequestEmail, COMPLETION_EMAILS_APPROVED, INSTALL_COMPLETE_EMAIL_APPROVED } from "../src/lib/completion-emails.core";
import { renderVeecReminderEmail, renderVeecCopyEmail, VEEC_SIGN_EMAIL_APPROVED, VEEC_COPY_EMAIL_APPROVED } from "../src/lib/veec-emails.core";
import { renderInstallerAcceptedEmail, renderInstallerDeclinedEmail, INSTALLER_ACCEPTED_EMAIL_APPROVED, INSTALLER_DECLINED_EMAIL_APPROVED } from "../src/lib/installer-accepted-email.core";
import { renderApplicationReceivedEmail, APPLICATION_RECEIVED_EMAIL_APPROVED } from "../src/lib/application-review.core";
import { renderInstallClearanceEmail, INSTALL_CLEARANCE_EMAIL_APPROVED } from "../src/lib/install-clearance.core";
import { partnerWelcomeEmail, partnerEmailLayout } from "../src/lib/partner-email.core";
import { renderConsentCopyEmail, CONSENT_COPY_EMAIL_APPROVED } from "../src/lib/consent-copy-email.core";
import { renderDepositReleasedEmail, PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED } from "../src/lib/deposit-release-notice.core";
import { collectionNoticeEmail, COLLECTION_NOTICE_EMAIL_APPROVED, COLLECTION_NOTICE_PARAGRAPHS } from "../src/lib/esc-collection-notice.core";
import { bankDetailLines, HIV_BANK_DETAILS } from "../src/lib/payments.core";
import { renderOwnerCancelledEmail, renderInstallerCancelledEmail, CANCEL_NOTICE_EMAILS_APPROVED } from "../src/lib/cancel-notice.core";
import { renderNewSenderReplyEmail } from "../src/lib/new-sender-reply-email.core";
import { NEW_SENDER_REPLY_APPROVED } from "../src/lib/new-sender-reply.core";

const JOB = "https://estimate.homeinsulationvictoria.com.au/my-job/tok";
const EST = "https://estimate.homeinsulationvictoria.com.au/estimate/tok";
const LINKS = { saveMySpotUrl: `${EST}/campaign`, uploadMediaUrl: `${EST}/video`, reviewResultUrl: EST, calculatorUrl: `${EST}/calculator` };
const HELEN = { firstName: "Helen", propertyAddress: "824 High Street Road, Glen Waverley VIC 3150", enquiryReference: "HV-3117" };
const FIG = { veuRebate: 1610, customerTotal: 2188, totalBeforeRebate: 3798, installation: 3100, piesaFee: 349, apFee: 349, ceilingAreaM2: 137, areaEstimated: false };
const REINSULATE = { name: "Reinsulate", phone: "0400 000 000" };

/** Retired wording (scripts/scan-retired-terms.ts customer-visible terms) must never appear. */
const RETIRED = [/\bHI ?VIC!?(?![a-z_])/, /50 ?% deposit/i, /measure[- ]up (?:&amp;|&|and) eligibility check/i, /combined ready check/i, /piesa before (quote|payment)/i, /\$220 lead fee/i, /5[- ]year workmanship/i];
const shell = (html: string, text: string, unsubscribe: boolean) => {
  expect(html.startsWith("<!doctype html")).toBe(true);
  expect(html).toContain(`src="${MAIL_LOGO_URL}"`);
  expect(html).toContain('alt="Home Insulation Victoria"');
  expect(html).not.toContain("data:image"); // Gmail and Outlook block embedded images: the logo is hosted
  expect(html.match(/VEU Accredited Person A003654/g)?.length).toBeGreaterThanOrEqual(1);
  expect(html).toContain("ABN 44 671 613 979");
  expect(text).toContain(FOOTER_TEXT);
  expect(html.includes(">Unsubscribe</a>") || html.includes("<!--HIV_SECURE_UNSUBSCRIBE_LINK-->")).toBe(unsubscribe);
  expect(html).not.toMatch(/display:\s*flex/);
  expect(html).not.toMatch(/<script|\son[a-z]+=/i);
  for (const re of RETIRED) { expect(html).not.toMatch(re); expect(text).not.toMatch(re); }
  expect(html).not.toContain("Accredited Provider"); expect(text).not.toContain("Accredited Provider"); // we are the Accredited Person
};
const has = (s: string, parts: string[]) => { for (const p of parts) expect(s).toContain(p); };
const ENT: Record<string, string> = { nbsp: " ", amp: "&", rarr: "→", rsaquo: "›", middot: "·", lt: "<", gt: ">", quot: '"' };
/** The visible lines of an email (head, Outlook-only blocks and tags removed, entities decoded). */
const visLines = (html: string) => html.replace(/<head>[\s\S]*?<\/head>/, "").replace(/<!--\[if[\s\S]*?<!\[endif\]-->/g, "")
  .replace(/<br *\/?>|<\/(td|tr|div|p|h1|li)>/g, "\n").replace(/<[^>]*>/g, "")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&([a-z]+);/g, (m, n) => ENT[n] ?? m)
  .split("\n").map((l) => l.trim()).filter(Boolean);
/** Visible lines joined with " | ", so label/value pairs in tables can be checked as one fact. */
const vis = (html: string) => visLines(html).join(" | ");
/** The visible lines of an approved design in docs/templates/mjml, with its TEST sample values swapped for this test's. */
const designLines = (file: string, subs: [string, string][] = []) => {
  let src = readFileSync(`docs/templates/mjml/${file}.mjml`, "utf8");
  for (const p of ["header", "footer-owner", "footer-trade"]) src = src.replace(`<mj-include path="./partials/${p}.mjml" />`, readFileSync(`docs/templates/mjml/partials/${p}.mjml`, "utf8"));
  return visLines(renderMjml(src)).map((l) => subs.reduce((a, [f, t]) => a.split(f).join(t), l));
};
/** No link other than the frame's web-font stylesheets. */
const NO_LINK = /href="(?!https:\/\/fonts\.googleapis\.com\/)/;

describe("approved owner email designs", () => {
  test("O1 Save my spot", () => {
    const m = renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true, recipient: HELEN, figures: FIG, links: LINKS })!;
    shell(m.html, m.plainText, true);
    has(m.html, ["Helen, you could save $1,610 on ceiling insulation", "You save $1,610", "$2,188", "$3,798", "Based on what you told us: 137 m² ceiling, no existing insulation.", "Save my free spot", "What's included in $2,188", "Not included – only if needed"]);
  });
  test("O2 Save my spot, some insulation", () => {
    const m = renderJoOutcomeEmail({ outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, declaredThinPatchy: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS })!;
    shell(m.html, m.plainText, true);
    has(m.html, ["Helen, you may qualify for $1,610 off ceiling insulation", "Your potential rebate", "Your cost if eligible", "Your existing insulation", "Up to $2,055 for your 137 m² ceiling.", "$15/m²", "Save my free spot", "already R2.0 or above"]);
  });
  test("O2 insulation questions", () => {
    const m = renderJoOutcomeEmail({ outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, insulationQuestions: true, recipient: HELEN, figures: { ...FIG, removalUpTo: 2055 }, links: LINKS })!;
    shell(m.html, m.plainText, true);
    has(m.html, ["Save your spot: answer 3 quick questions", "What type is it?", "About how thick is it?", "When was your home built?", "Answer &amp; save my spot", `href="${EST}/video"`]);
  });
  test("O6 Not eligible", () => {
    const m = renderJoOutcomeEmail({ outcome: "does_not_appear_eligible", insulation: null, ceilingSizeKnown: false, recipient: HELEN, reason: "From the photos and details you sent us, the insulation already in your ceiling appears to be R2.0 or above.", links: LINKS })!;
    shell(m.html, m.plainText, true);
    has(m.html, ["Helen, your ceiling insulation result", "We'd rather tell you now than waste your time.", "appears to be R2.0 or above", "Review my result", "Send to a friend"]);
  });
  test("O7 Not in your area yet", () => {
    const m = renderCoverageUnavailableEmail({ firstName: "Helen", suburb: "Mildura", postcode: "3500", missing: ["REC / electrician", "installer"], reference: "HV-1" });
    shell(m.html, m.plainText, true);
    has(m.html, ["Helen, we're not in Mildura just yet", "Mildura 3500", "we won't rush it", "What happens now", "We keep your details on file.", "No payment, no obligation.", "Send to a friend"]);
  });
  test("O10 Spot saved", () => {
    const m = renderSpotSavedEmail({ firstName: "Helen", rebate: 1610, suburb: "Glen Waverley", shortAddress: "824 High Street Road, Glen Waverley", myJobUrl: JOB, optOutUrl: "https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t=x", referralUrl: "https://homeinsulationvictoria.com.au/homeowner?ref=r", estimate: { gross: 3798, customer: 2188, areaM2: 137, address: "824 High Street Road, Glen Waverley VIC 3150", calculatorUrl: `${EST}/calculator` } });
    shell(m.html, m.text, true);
    has(m.html, ["Smart move, Helen. Your spot is saved.", "Your $1,610 rebate is waiting", "You save $1,610", ">$2,188<", "Estimate incl. GST for 137 m². You'll see your exact price before you agree to anything.", "Your place is kept", "<strong>We'll be in touch</strong>", "When your spot is released, we'll tell you your next step.", ">See my job<", "What's included in $2,188", "Have a friend who needs a spot saved?"]);
  });
  test("O11 Ready Check times", () => {
    const m = renderReadyCheckTimesEmail({ firstName: "Helen", suburb: "Glen Waverley", installerName: "Deep Insulation", times: ["Tuesday 28 October at 8:00am", "Wednesday 29 October at 12:30pm", "Friday 31 October at 7:30am"], myJobUrl: JOB, estimate: { rebate: 1610, price: 2188, areaM2: 137 } });
    shell(m.html, m.text, false);
    has(m.html, ["Helen, pick a time for your free Ready Check", "a certified installer near Glen Waverley is ready for you", ">Tuesday 28 October<", "8:00am &rsaquo;", "12:30pm &rsaquo;", "Suggest other days", "At your Ready Check", "You save $1,610", "What's included in $2,188"]);
    expect(READY_CHECK_TIMES_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("O12 Ready Check booked", () => {
    const m = renderReadyCheckBookedEmail({ firstName: "Helen", when: "Tuesday 28 October at 8:00am", installerName: "Deep Insulation", installerPhone: "0400 000 000", address: "824 High Street Road, Glen Waverley", changed: false, myJobUrl: JOB, estimate: { rebate: 1610, price: 2188, areaM2: 137 } });
    shell(m.html, m.text, false);
    has(m.html, ["You're booked, Helen", "Your free Ready Check is confirmed.", "Your Ready Check</div>", ">Tuesday 28 October<", ">8:00am<", "Installer: Deep Insulation · 0400 000 000", "Before they arrive", "<strong>ceiling hatch</strong>", "<strong>Change time</strong>", "call or text Deep Insulation on 0400 000 000", ">See my job<", "What's included in $2,188"]);
    expect(READY_CHECK_BOOKED_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  const quote = { firstName: "Helen", address: "824 High Street Road, Glen Waverley VIC 3150", totalIncGst: 2200, rebateIncGst: 1850, subtotalIncGst: 4050, areaM2: 137.6, removalM2: 40, product: "Bradford Gold R5.0", installerName: "Reinsulate", installerCertified: true, safetyCheckPrice: 349,
    lines: [{ description: "Bradford Gold R5.0 ceiling batts, supplied and installed", lineTotalIncGst: 2752 }, { description: "Old insulation removed and taken away", lineTotalIncGst: 600 }, { description: "Electrical safety check (PIESA)", lineTotalIncGst: 349 }, { description: "Accredited Provider fee", lineTotalIncGst: 349 }],
    quoteUrl: `${JOB}?screen=quote`, validUntil: new Date("2026-11-07T12:59:59.999Z"), officePhone: null, unsubscribeUrl: "https://estimate.homeinsulationvictoria.com.au/u/x" };
  test("O18 Quote ready", () => {
    const m = renderOwnerQuoteEmail(quote);
    shell(m.html, m.text, true);
    has(m.html, ["Hi Helen, your quote is ready.", "You save $1,850 on ceiling insulation", "Taken off upfront. Nothing for you to claim.", ">$2,200.00<", "$4,050.00", "Measured at your Ready Check", ">View and accept your quote<", ">Your quote</div>", "137.6 m² × $20.00 per m²", "installed by Reinsulate, EEC-certified (AS 3999)", "40 m² × $15.00 per m²", "By a licensed electrician, before any insulation goes in", "Home Insulation Victoria (VEU A003654)", ">Full price<", "−$1,850.00", ">You pay<", "Not included: electrical fixes", "accept and pay $349.00", "held until 7 November 2026"]);
    expect(OWNER_QUOTE_EMAIL_APPROVED).toBe(true);
  });
  test("O19 Quote reminder", () => {
    const m = renderQuoteReminderEmail({ ...quote, kind: "day3" });
    shell(m.html, m.text, true);
    has(m.html, ["Helen, your quote is waiting", "Just checking you saw it.", "your price is held until 7 November", "You save $1,850", ">$2,200.00<", ">View and accept your quote<", "Not ready, or not for you?"]);
    expect(m.html).not.toContain(">Your quote</div>");
    expect(QUOTE_REMINDER_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("O22 You're in", () => {
    const m = renderYoureInEmail({ firstName: "Helen", rebate: 1850, totalIncGst: 2200, payment: { amount: 349, paidOn: "24 Oct 2026", cardLast4: "4242" }, installerName: "Reinsulate", myJobUrl: JOB });
    shell(m.html, m.text, false);
    has(m.html, ["You're in, Helen!", "with $1,850 off", "Payment received", ">$349.00<", "Paid 24 Oct 2026 · card ending 4242", "Paid &#10003;", "Still to pay: $1,851.00 (10% to book your install day, the rest on install day)", "Electrical safety check", "Only if something needs fixing", "Book your install day", "Reinsulate offers you 3 days", ">See my job<", "signed acceptance and receipt are attached"]);
    expect(ACCEPTANCE_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("O26 Safety check times (+ the 30-day clock)", () => {
    const m = renderSafetyCheckTimesEmail({ firstName: "Helen", electricianName: "Spark Electrical", times: ["Wednesday 5 November at 8:00am", "Thursday 6 November at 12:30pm", "Monday 10 November at 7:30am"], myJobUrl: JOB, paid: 349 });
    shell(m.html, m.text, false);
    has(m.html, ["Helen, pick a time for your electrical safety check", "Spark Electrical, a licensed electrician, has offered these times.", ">Wednesday 5 November<", "Suggest other days", "&#9200; The 30-day clock", "Your install must happen within 30 days of this safety check.", "a new check may be charged", "At your safety check", "It's already paid for ($349.00)."]);
    expect(m.text).toContain("The 30-day clock");
    const b = renderSafetyCheckBookedEmail({ firstName: "Helen", when: "Wednesday 5 November at 8:00am", electricianName: "Spark Electrical", electricianPhone: "0400 111 222", address: "824 High Street Road, Glen Waverley", changed: false, myJobUrl: JOB });
    shell(b.html, b.text, false);
    has(b.html, ["You're booked, Helen", "Your electrical safety check is confirmed.", "Electrician: Spark Electrical · 0400 111 222", "&#9200; The 30-day clock", "<strong>switchboard</strong>", ">See my job<"]);
    expect(SAFETY_CHECK_EMAILS_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("O28 PIESA copy", () => {
    const m = renderPiesaCopyEmail({ recipient: "owner", firstName: "Helen", address: "824 High Street Road, Glen Waverley", jobNumber: "HV-3117", signatureDate: "2026-11-05", installStart: "2026-11-10T20:30:00Z", link: `${JOB}?doc=piesa`, electrician: { name: "Spark Electrical", licence: "12345", rec: "67890" } });
    shell(m.html, m.text, false);
    has(m.html, ["Helen, your electrical safety check: all clear", "at least 24 hours before your install", "Safety check result", "Safe to insulate &#10003;", "Thursday 5 November 2026", "Spark Electrical · Lic. 12345 · REC 67890", ">None<", "Wednesday 11 November, arriving 7:30am", "<strong>Your signed safety check is attached to this email (PDF).</strong>", ">See my job</a>", `href="${JOB}?doc=piesa"`, "<strong>please don't let anyone into the ceiling before the install.</strong>"]);
    expect(PIESA_COPY_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("O29 Electrical fixes quote (+ the 30-day clock with the expiry date)", () => {
    const m = renderFixesQuoteEmail({ firstName: "Helen", electricianName: "Spark Electrical", checkedOn: "Wednesday 5 November", found: ["4 old downlights that can't be covered by insulation", "One ceiling cable joint that isn't enclosed"], lines: [{ description: "Replace 4 downlights with IC-rated LEDs", detail: "4 × $120.00, supplied and installed", lineTotalIncGst: 480 }, { description: "Enclose cable joint in a junction box", detail: "Labour and parts", lineTotalIncGst: 200 }], totalIncGst: 680, expiresOn: "5 December", approveUrl: `${JOB}?screen=quote` });
    shell(m.html, m.text, false);
    has(m.html, ["Helen, your safety check found something to fix first", "Spark Electrical checked your home on Wednesday 5 November.", "What they found", "4 old downlights", "Your fixes quote", ">$480.00<", "Total incl. GST", ">$680.00<", "&#9200; The 30-day clock", "<strong>Please approve this quickly.</strong>", "on <strong>5 December</strong>", "Our office checked this quote before it reached you.", "Certificate of Electrical Safety", "Approve and pay $680.00"]);
    expect(FIXES_QUOTE_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("O33 Install days", () => {
    const m = renderInstallDaysEmail({ firstName: "Helen", installerName: "Reinsulate", days: ["Tuesday 11 November at 8:00am", "Thursday 13 November at 12:30pm", "Monday 17 November at 7:30am"], myJobUrl: JOB, balanceIncGst: 1851, installBy: "4 December" });
    shell(m.html, m.text, false);
    has(m.html, ["Helen, pick your install day", "Your safety check is all clear. Reinsulate has offered these days", ">Tuesday 11 November<", "Suggest other days", "Lock in your day", "sign your install consent", "pay your 10% deposit of $185.10", "Once it's in, your day is locked in", "The rest, $1,665.90, is due on install day", "<strong>Your install must happen by 4 December</strong>, 30 days after your safety check"]);
    expect(INSTALL_DAYS_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("O35 Install booked", () => {
    const m = renderInstallBookedEmail({ firstName: "Helen", when: "Tuesday 11 November at 7:30am", address: "824 High Street Road, Glen Waverley", installerName: "Reinsulate", installerPhone: "0400 000 000", removal: true, myJobUrl: JOB, consentSigned: true, payment: { depositPaid: 185.1, cardLast4: "4242", balanceDue: 1665.9, payInFullUrl: `${JOB}?pay=full` } });
    shell(m.html, m.text, false);
    has(m.html, ["Your install is booked, Helen", "Consent signed and deposit received ✓", ">Arriving 7:30am<", "Installer: Reinsulate · 0400 000 000", "Deposit paid · card ending 4242", "$185.10", "Balance due on install day", "$1,665.90", ">Pay in full<", "Your power will be off", "On the day", "An adult (18+) at home", "so expect some dust", "Use Change day on your job page", ">See my job<"]);
    expect(INSTALL_BOOKED_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("O42 Install day changed", () => {
    const m = renderInstallDayChangedEmail({ firstName: "Helen", installerName: "Reinsulate", installerPhone: "0400 000 000", address: "824 High Street Road, Glen Waverley", when: "Thursday 13 November at 7:30am", was: "Tuesday 11 November at 7:30am", myJobUrl: JOB });
    shell(m.html, m.text, false);
    has(m.html, ["Helen, your install day has changed", "your deposit still holds your booking", "New install day", ">Thursday 13 November<", ">Arriving 7:30am<", "Was <span class=\"strike\" style=\"text-decoration:line-through\">Tuesday 11 November, 7:30am</span>", "Tap Change day on your job page", ">See my job<"]);
    expect(m.subject).toBe("Your install has moved to Thursday 13 November at 7:30am");
  });
  test("O44 Install complete", () => {
    const m = renderInstallCompleteEmail({ firstName: "Helen", installer: REINSULATE, product: "Bradford Gold R5.0", areaM2: 137.6, rebate: 1850, balancePaid: true, signRebateFormUrl: `${JOB}?screen=assignment` });
    shell(m.html, m.text, false);
    has(m.html, ["All done, Helen. Enjoy a warmer home!", "137.6 m² Bradford Gold R5.0", "$1,850 off", "Paid in full ✓", "One last thing: sign your rebate form", ">Sign your rebate form<", "What you'll get from us", "Your completion pack", "1-year workmanship warranty, the 5-year product warranty", "A copy of your signed rebate form", "Contact Reinsulate first on 0400 000 000"]);
    expect(COMPLETION_EMAILS_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
    expect(INSTALL_COMPLETE_EMAIL_APPROVED).toBe(true); // decision 169: O44 is the day-0 rebate-form request
  });
  const UNSUB = "https://estimate.homeinsulationvictoria.com.au/u/x";
  test("O61 VEEC reminder (days 1/3/7) matches the approved design line for line", () => {
    const m = renderVeecReminderEmail({ firstName: "Helen", rebate: 1850, signUrl: `${JOB}?screen=done`, unsubscribeUrl: UNSUB });
    shell(m.html, m.text, true);
    expect(visLines(m.html)).toEqual(designLines("owner_O61"));
    has(m.html, [">Helen, your rebate form still needs your signature</div>", "We can't claim your $1,850 Victorian Energy Upgrades rebate", ">Sign your rebate form</a>", `href="${JOB}?screen=done"`, `href="${UNSUB}"`, "Something on the form look wrong? Reply to this email before signing."]);
    expect(m.subject).toBe("Helen, your rebate form still needs your signature");
    has(m.text, ["$1,850", `Sign your rebate form: ${JOB}?screen=done`, `Unsubscribe: ${UNSUB}`]);
    expect((m.html.match(/Sign your rebate form/g) ?? []).length).toBe(1); // the one button only, no second ask
    expect(VEEC_SIGN_EMAIL_APPROVED).toBe(true);
  });
  test("O62 VEEC signed copy matches the approved design line for line", () => {
    const m = renderVeecCopyEmail({ firstName: "Helen", jobNumber: "HV-3117", signedAt: "2026-11-21T03:00:00.000Z", myJobUrl: `${JOB}?screen=done`, unsubscribeUrl: UNSUB });
    shell(m.html, m.text, true);
    expect(visLines(m.html)).toEqual(designLines("owner_O62", [["HV-TEST", "HV-3117"]]));
    has(m.html, [">Here's your signed rebate form, Helen</div>", "for HV-3117 is attached", "<strong>Signed on 21 November 2026</strong>", ">See my job</a>", `href="${JOB}?screen=done"`, "veu@esc.vic.gov.au"]);
    expect(m.subject).toBe("Here's your signed rebate form, Helen");
    has(m.text, ["HV-3117", "Signed on 21 November 2026.", `See my job: ${JOB}?screen=done`]);
    expect(VEEC_COPY_EMAIL_APPROVED).toBe(true);
  });
  test("O45 Final invoice", () => {
    const m = renderFinalInvoiceEmail({ firstName: "Helen", ownerName: "Helen Yang", address: "824 High Street Road, Glen Waverley VIC 3150", installer: REINSULATE, invoiceNumber: "HIV-3117", invoiceDate: "11 November 2026", lines: [{ description: "Bradford Gold R5.0 ceiling batts, 137.6 m² supplied and installed", amount: 2752 }, { description: "Old insulation removed and taken away, 40 m²", amount: 600 }, { description: "Electrical safety check (PIESA)", amount: 349 }, { description: "Accredited Provider fee", amount: 349 }], totalIncGst: 4050, gst: 368.18, rebate: 1850, payments: [{ label: "safety check (24 Oct)", amount: 349 }, { label: "deposit (4 Nov)", amount: 185.1 }], balanceDue: 1665.9, bank: { accountName: "Home Insulation Victoria", bsb: "082902", accountNumber: "777966349", payId: null, configured: true }, installed: { description: "Ceiling insulation — CSR Bradford Gold Ceiling Batt R5.0 — 137.6 m²", escModelCodes: ["467911"] } });
    shell(m.html, m.text, false);
    // Decision 209 / Activity Guide v1.2 Table 4: consumer name, installation address, business name/address/ABN, brand/model/R-value, m², price before, VEEC incentive, amount after, invoice date.
    has(m.html, ["Helen, your install is done. Here's your final invoice", "DC Construction Solutions Pty Ltd trading as Home Insulation Victoria · 1/33 Altree Court, Phillip ACT 2606 · ABN 44 671 613 979", ">$4,050.00<", "VEEC incentive (your VEU rebate, price reduction)", "Amount after VEEC incentive", ">$2,200.00<", "Paid: safety check (24 Oct)", "Balance due today", ">$1,665.90<", "completion pack"]);
    has(vis(m.html), ["Tax invoice HIV-3117 | 11 November 2026", "To: Helen Yang", "Installation address: 824 High Street Road, Glen Waverley VIC 3150", "Installed: Ceiling insulation — CSR Bradford Gold Ceiling Batt R5.0 — 137.6 m² (ESC model 467911)", "Accredited Person fee | $349.00", "Total incl. GST (GST $368.18) | $4,050.00", "VEEC incentive (your VEU rebate, price reduction) | −$1,850.00", "Amount after VEEC incentive | $2,200.00", "Paid: safety check (24 Oct) | −$349.00", "Paid: deposit (4 Nov) | −$185.10", "Balance due today | $1,665.90"]);
    expect(m.html).not.toContain("VEEC discount");
    // Decision 334: bank transfer only — bank details, the invoice number as the reference; no card wording, no Pay button.
    has(m.html, ["Please pay by bank transfer using the details below, with your invoice number as the reference.", "Pay by bank transfer"]);
    has(vis(m.html), ["Pay by bank transfer | Account name | Home Insulation Victoria | BSB | 082-902 | Account | 777966349 | Reference | HIV-3117 | Amount | $1,665.90"]);
    has(m.text, ["PAY BY BANK TRANSFER", "BSB 082-902 · Account 777966349", "Reference: HIV-3117"]);
    for (const out of [m.html, m.text]) for (const gone of ["card", "Stripe", "Tap the button", "Pay $1,665.90 now", "Invoice PDF attached"]) expect(out.replace(/class="card(-outlook)?"|\.card\{/g, "")).not.toContain(gone); // the frame's "card" CSS class is not card wording
    // "Invoice PDF attached" only when the PDF really is attached.
    const withPdf = renderFinalInvoiceEmail({ firstName: "Helen", ownerName: null, address: null, installer: REINSULATE, invoiceNumber: "HIV-3117", invoiceDate: "11 November 2026", lines: [{ description: "Ceiling insulation", amount: 2752 }], totalIncGst: 2752, gst: null, rebate: 1850, payments: [], balanceDue: 902, bank: { accountName: "Home Insulation Victoria", bsb: "082902", accountNumber: "777966349", payId: null, configured: true }, invoicePdfAttached: true });
    expect(withPdf.html).toContain("Invoice PDF attached");
    // Bank details not configured: says so instead of blanks.
    const unset = renderFinalInvoiceEmail({ firstName: "Helen", ownerName: null, address: null, installer: REINSULATE, invoiceNumber: "HIV-3117", invoiceDate: "11 November 2026", lines: [{ description: "Ceiling insulation", amount: 2752 }], totalIncGst: 2752, gst: null, rebate: 1850, payments: [], balanceDue: 902, bank: { accountName: "Home Insulation Victoria", bsb: null, accountNumber: null, payId: null, configured: false } });
    expect(unset.html).toContain("to be confirmed");
    expect(() => renderFinalInvoiceEmail({ firstName: "Helen", ownerName: null, address: null, installer: REINSULATE, invoiceNumber: " ", invoiceDate: "11 November 2026", lines: [], totalIncGst: 0, gst: null, rebate: 0, payments: [], balanceDue: 1, bank: { accountName: "Home Insulation Victoria", bsb: "082902", accountNumber: "777966349", payId: null, configured: true } })).toThrow(/Invoice number/);
    const noCodes = renderFinalInvoiceEmail({ firstName: "Helen", ownerName: "Helen Yang", address: "824 High Street Road, Glen Waverley VIC 3150", installer: REINSULATE, invoiceNumber: "HIV-3117", invoiceDate: "11 November 2026", lines: [{ description: "Ceiling insulation", amount: 2752 }], totalIncGst: 2752, gst: null, rebate: 1850, payments: [], balanceDue: 902, bank: { accountName: "Home Insulation Victoria", bsb: "082902", accountNumber: "777966349", payId: null, configured: true }, installed: null });
    expect(noCodes.html).not.toContain("Installed:");
    expect(noCodes.html).not.toContain("ESC model");
  });
  test("O47 Completion pack", () => {
    const m = renderCompletionPackEmail({ firstName: "Helen", installer: REINSULATE, downloads: { certificateUrl: `${JOB}?doc=cert`, invoiceUrl: `${JOB}?doc=invoice`, warrantiesUrl: `${JOB}?doc=warranty`, signedFormsUrl: `${JOB}?doc=forms` }, installed: { description: "Ceiling insulation — Earthwool Ceiling batt R5.0 — 120 m²", escModelCodes: ["2437543"] } });
    shell(m.html, m.text, false);
    has(vis(m.html), ["Installed | Ceiling insulation — Earthwool Ceiling batt R5.0 — 120 m² | ESC model 2437543"]);
    expect(m.text).toContain("Installed: Ceiling insulation — Earthwool Ceiling batt R5.0 — 120 m² (ESC model 2437543)");
    expect(renderCompletionPackEmail({ firstName: "Helen", installer: REINSULATE, downloads: { certificateUrl: null, invoiceUrl: null, warrantiesUrl: null, signedFormsUrl: null } }).html).not.toMatch(/>Installed<|ESC model/);
    has(m.html, ["Your completion pack, Helen", "Certificate of Completion", "Tax invoice", "1-year installer workmanship · 5-year product warranty", "Signed forms", ">Download</a>", `href="${JOB}?doc=cert"`, `href="${JOB}?doc=invoice"`, `href="${JOB}?doc=warranty"`, `href="${JOB}?doc=forms"`, "Something not right?", "Contact your installer first", "Reinsulate · 0400 000 000. Workmanship is covered for 1 year.", "Essential Services Commission", "Looking after your insulation", "IC-rated"]);
  });
  test("O51 Review request", () => {
    const m = renderReviewRequestEmail({ firstName: "Helen", installer: REINSULATE, starUrl: (n) => `${JOB}?stars=${n}`, googleReviewUrl: "https://g.page/r/x/review", referralUrl: "https://homeinsulationvictoria.com.au/homeowner?ref=r" });
    shell(m.html, m.text, false);
    has(m.html, ["Helen, how's your home feeling?", "It's been a week since Reinsulate installed", "Tap a star", `href="${JOB}?stars=5"`, "&#9733;", "Leave a Google review", "Know someone with a cold house?", "Send to a friend", "Contact Reinsulate first on 0400 000 000"]);
    expect((m.html.match(/&#9733;/g) ?? []).length).toBe(5);
  });
  // Decision 170 (Jo 24 Oct 2026): the samples in docs/templates/owner and installer are written by scripts/render-decision-170-samples.ts from this data.
  test("O63 Consent copy", () => {
    const form = ["Section 1: Information to be shared", "First Name: Helen", "Last Name: Yang", "Address of premises: 824 High Street Road, Glen Waverley VIC 3150", "Installation day(s): Tuesday 11 November 2026", "", "Section 2: Owner declarations", "☑ I consent to the Accredited Person sharing this information with the Essential Services Commission", "☑ I understand the information is used to verify the installation and the VEEC claim", "☑ I am the owner or authorised representative of the premises", "☑ I have read and understood this form", "", "Owner signature: Helen Yang  Date: 24 October 2026", "AP representative: Jo Carter (Director)  Date: 24 October 2026"].join("\n");
    const m = renderConsentCopyEmail({ firstName: "Helen", installationDays: ["2026-11-11"], address: "824 High Street Road, Glen Waverley VIC 3150", templateVersion: "esc-2026-10-v1", formText: form, sha256: "e6458b32666a01a5a3d06718cf0ee33b601077761c6f14f77d20bee5d7753151", myJobUrl: JOB, attached: true });
    shell(m.html, m.text, false);
    expect(m.subject).toBe("Your signed consent form");
    has(m.html, [">Hi Helen,</div>", ">Your signed consent form</div>", "Here's your copy of the owner's consent form you signed for the ceiling insulation at 824 High Street Road, Glen Waverley VIC 3150. The signed form is attached as a PDF.", ">See my job</a>", `href="${JOB}"`, "Your signed form", "Record reference e6458b32666a"]);
    // The signed form's own lines, as signed (label | value rows).
    has(vis(m.html), ["Section 1: Information to be shared", "First name | Helen", "Last Name | Yang", "Address of premises | 824 High Street Road, Glen Waverley VIC 3150", "Installation day(s) | Tuesday 11 November 2026", "Section 2: Owner declarations", "☑ I consent to the Accredited Person sharing this information with the Essential Services Commission", "☑ I have read and understood this form", "Owner signature | Helen Yang | Date | 24 October 2026", "AP representative | Jo Carter (Director)", "Form esc-2026-10-v1 · Record reference e6458b32666a"]);
    has(m.text, ["Hi Helen,", "First name: Helen", "Owner signature: Helen Yang  Date: 24 October 2026", "AP representative: Jo Carter (Director)  Date: 24 October 2026", `See my job: ${JOB}`]);
    expect(CONSENT_COPY_EMAIL_APPROVED).toBe(true);
  });
  test("O64 Deposit released", () => {
    const m = renderDepositReleasedEmail({ firstName: "Helen", day: "Tuesday 11 November", link: JOB, depositAmount: "$185.10", bankLines: bankDetailLines(HIV_BANK_DETAILS, "Home Insulation Victoria HV-3117") });
    shell(m.html, m.text, false);
    expect(m.subject).toBe("Helen, your install day was released");
    has(m.html, [">Hi Helen,</div>", ">Your install day was released</div>", "We didn't receive your install deposit in time, so Tuesday 11 November has been released. Your installer will offer new days once it's paid.", "Pay your $185.10 deposit by card, bank transfer or PayID", ">See my job</a>", `href="${JOB}"`]);
    has(vis(m.html), ["Account name | Home Insulation Victoria | BSB | 082-902 | Account | 777966349 | Reference | Home Insulation Victoria HV-3117"]);
    has(m.text, ["Account name: Home Insulation Victoria", "BSB 082-902 · Account 777966349", "Reference: Home Insulation Victoria HV-3117"]);
    expect(visLines(m.html)).toEqual(designLines("owner_O64", [["Wednesday 11 November", "Tuesday 11 November"], ["HV-TEST", "HV-3117"]]));
    expect(PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED).toBe(true);
  });
  // Decision 291 (Jo 25 Oct 2026): the samples in docs/templates/owner and installer are written by scripts/render-decision-291-samples.ts from this data.
  test("O69 Job cancelled (owner): Jo's wording verbatim, no link, no price; matches the approved design", () => {
    const m = renderOwnerCancelledEmail({ firstName: "Helen", jobNumber: "HV-3117", address: "824 High Street Road, Glen Waverley VIC 3150", officePhone: "03 9000 0000" });
    shell(m.html, m.text, false);
    expect(m.subject).toBe("Your ceiling insulation job HV-3117 has been cancelled");
    has(m.html, [">Job cancelled</div>", ">Hi Helen,</div>", "We've cancelled your ceiling insulation job at 824 High Street Road, Glen Waverley VIC 3150, as discussed. Nothing further will happen on it and you won't hear from us again about it unless you get back in touch.", "If this was a mistake or you'd like to pick it up again later, reply to this email.", ">Home Insulation Victoria</div>"]);
    expect(m.html).not.toMatch(/\$\d/); expect(m.html).not.toMatch(NO_LINK);
    has(m.text, ["Hi Helen,", "reply to this email.", "Home Insulation Victoria"]); expect(m.html + m.text).not.toMatch(/call us|03 9000/);
    expect(visLines(m.html)).toEqual(designLines("owner_O69"));
    // No office number on file: the reply line only (nothing invented).
    expect(renderOwnerCancelledEmail({ firstName: null, jobNumber: "HV-3117", address: null, officePhone: null }).html).toContain("If this was a mistake or you'd like to pick it up again later, reply to this email.</div>");
    expect(renderOwnerCancelledEmail({ firstName: null, jobNumber: "HV-3117", address: null, officePhone: null }).html).toContain(">Hi there,</div>");
    expect(CANCEL_NOTICE_EMAILS_APPROVED).toBe(true);
  });
});

describe("approved installer email designs", () => {
  const job = { installerFirstName: "Sam", ownerName: "Helen Yang", address: "824 High Street Road, Glen Waverley", jobNumber: "HV-3117", jobUrl: "https://estimate.homeinsulationvictoria.com.au/field/j" };
  test("I23 Owner accepted", () => {
    const m = renderInstallerAcceptedEmail(job);
    shell(m.html, m.text, false);
    has(vis(m.html), ["Good news, Sam. | Helen accepted!"]);
    has(m.html, ["Helen Yang has accepted the quote for 824 High Street Road, Glen Waverley (HV-3117)", "paid for the electrical safety check", "Electrical safety check", "Offer Helen 3 install days", "Install within 30 days", ">Open the job<"]);
    expect(m.html).not.toMatch(/\$\d/);
    expect(INSTALLER_ACCEPTED_EMAIL_APPROVED).toBe(true);
  });
  test("I24 Owner declined", () => {
    const m = renderInstallerDeclinedEmail({ ...job, reasonLabel: "Price too high", reasonNote: "We've decided to wait until next year." });
    shell(m.html, m.text, false);
    has(vis(m.html), ["Sam, | Helen has declined the quote", "Helen Yang declined the quote for 824 High Street Road, Glen Waverley (HV-3117).", "Reason given | Price too high"]);
    has(m.html, ["We've decided to wait until next year.", "Nothing more to do. The job is closed.", ">See the job<"]);
    expect(m.html).not.toMatch(/\$\d/);
    expect(INSTALLER_DECLINED_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("I53 Application received", () => {
    const m = renderApplicationReceivedEmail({ contactName: "Sam", businessName: "Reinsulate" });
    shell(m.html, m.text, false);
    has(vis(m.html), ["Thanks Sam, | We've got your application"]);
    has(m.html, [ "Reinsulate's application to install under the VEU program", "We check your details", "min $5 million", "You're approved", "Start adding jobs", "about 30 seconds"]);
    expect(APPLICATION_RECEIVED_EMAIL_APPROVED).toBe(true); // approved by Jo 24 Oct 2026 (tests/approved-flags.test.ts lists the decision)
  });
  test("I54 Welcome", () => {
    const m = partnerWelcomeEmail({ firstName: "Sam", businessName: "Reinsulate", trade: "installer", email: "sam@reinsulate.test", link: "https://estimate.homeinsulationvictoria.com.au/reset-password?token_hash=t&type=recovery&next=%2Ffield%2Fwelcome", test: false });
    shell(m.html, m.text, false);
    has(vis(m.html), ["Welcome aboard, Sam. | You're approved!"]);
    has(m.html, ["Reinsulate can now take VEU ceiling insulation jobs", "Jobs sent to you, plus add your own customers", "We only add our $349 AP fee", "Quotes, electrician, compliance and rebate paperwork handled by us", ">Set your password<", "New to how we work?", "Read the 2-minute guide", 'href="https://estimate.homeinsulationvictoria.com.au/field/guide"']);
  });
  test("I62 Privacy notice copy (decision 170): partner kit, notice verbatim, acknowledged date, reply line", () => {
    const n = collectionNoticeEmail({ firstName: "Sam", acknowledgedAt: "2026-10-24T01:00:00.000Z" });
    expect(n.subject).toBe("Your copy of the ESC privacy collection notice");
    const m = partnerEmailLayout({ subject: n.subject, heading: n.heading, blocks: n.blocks, test: false });
    shell(m.html, m.text, false);
    has(m.html, ["Your copy of the ESC privacy collection notice", ">Hi Sam,</div>", "which you acknowledged on 24 October 2026 at 12:00 pm"]);
    has(vis(m.html), ["VEU Scheme Participant Privacy Collection Notice | Version 1.0 – 1 October 2026", "privacy@esc.vic.gov.au"]);
    for (const p of COLLECTION_NOTICE_PARAGRAPHS) if (p.kind === "p" || p.kind === "li" || p.kind === "li2") expect(m.text).toContain(p.text);
    for (const p of COLLECTION_NOTICE_PARAGRAPHS) if (p.kind === "p" || p.kind === "li" || p.kind === "li2") expect(visLines(m.html).join("\n")).toContain(p.text.replace(/^[–-] /, ""));
    expect(visLines(m.html)).toEqual(designLines("installer_I62"));
    expect(COLLECTION_NOTICE_EMAIL_APPROVED).toBe(true);
  });
  test("I65 Cleared for install (decision 186): headline, one line, 30-day box, Offer install days; matches the approved design line for line", () => {
    const m = renderInstallClearanceEmail({ jobNumber: "HV-3117", ownerFirstName: "Helen", fixesSignedOff: false, deadlineLabel: "23 November 2026", jobUrl: job.jobUrl });
    shell(m.html, m.text, false);
    expect(m.subject).toBe("HV-3117 is cleared for install – offer 3 install days by 23 November 2026");
    has(m.html, [">HV-3117 is cleared for install</div>", "The electrical safety check is done. Offer Helen three install days with arrival times from your job page.", "&#9200; The 30-day clock", "The install must happen within 30 days of this safety check (by 23 November 2026).", "a new check may be charged", ">Offer install days</a>", `href="${job.jobUrl}"`]);
    expect(m.html).not.toMatch(/\$\d/);
    expect(visLines(m.html)).toEqual(designLines("installer_I65", [["HV-TEST", "HV-3117"], ["4 December 2026", "23 November 2026"]]));
    has(m.text, ["HV-3117 is cleared for install", "The 30-day clock: The install must happen within 30 days of this safety check (by 23 November 2026).", `Offer install days: ${job.jobUrl}`]);
    const fixed = renderInstallClearanceEmail({ jobNumber: "HV-3117", ownerFirstName: null, fixesSignedOff: true, deadlineLabel: "23 November 2026", jobUrl: job.jobUrl });
    expect(fixed.html).toContain("The electrical safety check is done, and the fixes are signed off. Offer the owner three install days with arrival times from your job page.");
    expect(INSTALL_CLEARANCE_EMAIL_APPROVED).toBe(true);
  });
  test("I70 Job cancelled (installer, decision 291): email not text, Jo's wording verbatim, no owner name or price; matches the approved design", () => {
    const m = renderInstallerCancelledEmail({ jobNumber: "HV-3117", place: "824 High Street Road, Glen Waverley", officePhone: "03 9000 0000" });
    shell(m.html, m.text, false);
    expect(m.subject).toBe("HV-3117 cancelled – 824 High Street Road, Glen Waverley");
    has(m.html, [">HV-3117 cancelled</div>", "HV-3117 at 824 High Street Road, Glen Waverley has been cancelled. Nothing more to do on it — it's gone from your list.", ">Questions: 03 9000 0000.</div>"]);
    expect(m.html).not.toMatch(/\$\d|Helen/); expect(m.html).not.toMatch(NO_LINK);
    expect(m.text).toContain("HV-3117 at 824 High Street Road, Glen Waverley has been cancelled. Nothing more to do on it — it's gone from your list.\n\nQuestions: 03 9000 0000.");
    expect(visLines(m.html)).toEqual(designLines("installer_I70", [["HV-TEST", "HV-3117"]]));
    expect(renderInstallerCancelledEmail({ jobNumber: "HV-3117", place: null, officePhone: null }).html).toContain(">HV-3117 at the property has been cancelled.");
    expect(renderInstallerCancelledEmail({ jobNumber: "HV-3117", place: null, officePhone: null }).html).toContain(">Questions: reply to this email.</div>");
    expect(CANCEL_NOTICE_EMAILS_APPROVED).toBe(true);
  });
  // Decision 292 (Jo 25 Oct 2026): the sample in docs/templates/owner is written by scripts/render-decision-292-sample.ts.
  test("O70 New sender → calculator (decision 292): Jo's wording verbatim, the one calculator link, Re: subject, no unsubscribe; matches the approved design", () => {
    const m = renderNewSenderReplyEmail({ theirSubject: "Ceiling insulation quote", firstName: "Sam" });
    shell(m.html, m.text, false);
    expect(m.subject).toBe("Re: Ceiling insulation quote");
    has(m.html, [">Hi Sam, thanks for getting in touch</div>", "You can check if your home is eligible for the insulation rebate and get a price estimate here: ", 'href="https://homeinsulationvictoria.com.au/homeowner"', "Once you've done that, we'll take it from there and be in touch about next steps.", ">Cheers,<br>the Home Insulation Victoria team</div>"]); // Jo 27 Oct, decision 413
    expect(m.html.match(/href="(?!https:\/\/fonts\.googleapis\.com\/)[^"]*"/g)).toEqual(['href="https://homeinsulationvictoria.com.au/homeowner"']); // the one calculator link
    expect(m.html).not.toMatch(/\$\d/);
    expect(visLines(m.html)).toEqual(designLines("owner_O70"));
    expect(NEW_SENDER_REPLY_APPROVED).toBe(true);
  });
});

describe("senders stay behind their flags (nothing new is sent to real people)", () => {
  test("new owner senders go only through sendOwnerTemplateEmail; test-send for TEST, guarded path for real", () => {
    const s = readFileSync("src/lib/owner-template-send.server.ts", "utf8");
    for (const t of ["sendTestEmail", "assertCustomerDeliveryAllowed", "sendGuardedOwnerEmail", "if (!p.approved)"]) expect(s).toContain(t);
    const a = readFileSync("src/lib/approved-owner-emails.server.ts", "utf8");
    expect(a).not.toMatch(/resend|fetch\(|sendRealSms|sendTestSms/i);
    for (const flag of ["QUOTE_REMINDER_EMAIL_APPROVED", "ACCEPTANCE_EMAIL_APPROVED", "SAFETY_CHECK_EMAILS_APPROVED", "FIXES_QUOTE_EMAIL_APPROVED", "INSTALL_DAYS_EMAIL_APPROVED", "COMPLETION_EMAILS_APPROVED"]) expect(a).toContain(flag);
    const d = readFileSync("src/lib/installer-declined-email.server.ts", "utf8");
    expect(d).toContain("if (!test && !INSTALLER_DECLINED_EMAIL_APPROVED)");
  });
  test("VEEC emails (decision 169): day 0 = the All done email once per job; O61/O62 only through test-send or the guarded path", () => {
    const r = readFileSync("src/lib/veec-reminders.server.ts", "utf8");
    expect(r).toContain("emailOwnerInstallComplete(jobId, {");
    expect(r).toContain("if (!request) {"); // no separate day-0 request email
    for (const t of ["sendTestEmail", "assertCustomerDeliveryAllowed", "sendGuardedOwnerEmail", "sendRealSms", "renderVeecReminderEmail"]) expect(r).toContain(t);
    expect(r).not.toMatch(/resend|fetch\(/i);
    expect(readFileSync("src/lib/approved-owner-emails.server.ts", "utf8")).toContain("key: `install-complete:v1:${jobId}`, approved: INSTALL_COMPLETE_EMAIL_APPROVED");
    const c = readFileSync("src/lib/veec-copy-email.server.ts", "utf8");
    for (const t of ["sendTestEmail", "assertCustomerDeliveryAllowed", "sendGuardedOwnerEmail", "renderVeecCopyEmail", "attachments: [attachment]", 'storage.from("job-files").download']) expect(c).toContain(t);
    expect(c).not.toMatch(/resend|fetch\(/i);
    expect(readFileSync("src/lib/veec-assignment-form.core.ts", "utf8")).not.toMatch(/veecSignEmail|veecCopyEmail/);
  });
  test("the touchpoint master marks the applied designs", () => {
    const html = readFileSync("docs/TOUCHPOINTS_MASTER.html", "utf8");
    expect((html.match(/Design applied/g) ?? []).length).toBeGreaterThanOrEqual(20);
  });
});
