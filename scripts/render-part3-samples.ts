// Part 3 Task 20 Step 5: render every changed owner email, text and page wording to docs/approved-samples/2026-11-03-part3/
// so the pictures can be shown to Jo. Emails -> .html (+ .txt plain version); texts -> texts.txt; page wording -> pages.html
// (430px wide, built from the same copy constants the pages read). Flags are forced ON in the render only: this script
// calls the pure renderers directly and changes nothing. Run: bun scripts/render-part3-samples.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { renderSpotReleasedEmail } from "../src/lib/spot-release-email.core";
import { spotReleasedText } from "../src/lib/spot-release.core";
import { ownerWillCallEmail, ownerWillCallText } from "../src/lib/owner-will-call.core";
import { ownerBookedNotice } from "../src/lib/owner-booked-notice.core";
import { visitTomorrowText } from "../src/lib/approved-texts.core";
import { quoteReminderDay3Text, quoteReminderExpiryText } from "../src/lib/approved-texts.core";
import { readyCheckNearlyThereEmail } from "../src/lib/ready-check-chase.core";
import { renderOwnerQuoteEmail, renderQuoteReminderEmail, ownerQuoteSms } from "../src/lib/owner-quote-email.core";
import { quoteChangeRows, QUOTE_CHANGES_HEADING, QUOTE_CHANGES_FOOTNOTE } from "../src/lib/quote-changes.core";
import { renderInstallerAcceptedEmail } from "../src/lib/installer-accepted-email.core";
import { renderSpotSavedEmail, spotSavedText } from "../src/lib/spot-saved-messages.core";
import { ownCustomerRentalTapsText, rentalOnlyLink, RENTAL_TAPS, RENTAL_DONE_LINE } from "../src/lib/rental-answers.core";
import { quickTapsLink } from "../src/lib/area-batch.core";
import { QUICK_TAPS_COPY, quickTapsPassLine, quickTapsGoLabel } from "../src/lib/quick-taps.core";
import { P2 } from "../src/lib/owner-pages.core";
import { quoteValidLine } from "../src/lib/quote-expiry.core";

const OUT = "docs/approved-samples/2026-11-03-part3";
mkdirSync(OUT, { recursive: true });
const office = { name: "Reinsulate Pty Ltd", tradingName: "Reinsulate", officePhone: "03 9000 0000", email: "office@reinsulate.example" };
const link = "https://estimate.homeinsulationvictoria.com.au/my-job/EXAMPLE";
const unsub = "https://estimate.homeinsulationvictoria.com.au/unsubscribe/EXAMPLE";
const start = "2026-11-10T22:00:00.000Z"; // Wed 11 Nov, 9:00am Melbourne
const held = (x: unknown) => { if (x && typeof x === "object" && "held" in x) throw new Error(`held: ${(x as { held: string }).held}`); return x as never; };

type Mail = { subject: string; html: string; text: string };
const emails: Record<string, Mail> = {};
emails["01-its-your-turn"] = renderSpotReleasedEmail({ firstName: "Sarah", confirmUrl: `${link}?screen=taps`, unsubscribeUrl: unsub, reminder: false });
emails["02-its-your-turn-day-2-reminder"] = renderSpotReleasedEmail({ firstName: "Sarah", confirmUrl: `${link}?screen=taps`, unsubscribeUrl: unsub, reminder: true });
emails["03-installer-will-call-you"] = held(ownerWillCallEmail({ firstName: "Sarah", installer: office, unsubscribeUrl: unsub }));
emails["04-youre-booked-ready-check"] = held(ownerBookedNotice({ kind: "ready_check", firstName: "Sarah", startIso: start, whoName: "Sam", business: office, changed: false }));
emails["05-your-time-has-changed"] = held(ownerBookedNotice({ kind: "ready_check", firstName: "Sarah", startIso: "2026-11-12T22:00:00.000Z", whoName: "Sam", business: office, changed: true }));
emails["06-nearly-there-to-installer-office"] = readyCheckNearlyThereEmail({ jobNumber: "HV-1234", address: "12 Example St, Box Hill", missing: ["finish and submit the form", "whether the homeowner agrees to be contacted"], mittiFormUrl: "https://app.mitti.example/forms/EXAMPLE" });
const quote = {
  firstName: "Sarah", address: "12 Example St, Box Hill VIC 3128", totalIncGst: 2188, rebateIncGst: 1610, subtotalIncGst: 3798,
  lines: [{ description: "R5.0 ceiling insulation, 137 m²", lineTotalIncGst: 3449 }, { description: "Electrical safety check (PIESA)", lineTotalIncGst: 349 }],
  quoteUrl: `${link}?screen=quote`, validUntil: new Date("2026-12-10T12:59:59Z"), officePhone: "03 9000 0000", unsubscribeUrl: unsub, safetyCheckPrice: 349,
  areaM2: 137, removalM2: 40, product: "Bradford Gold R5.0", installerName: "Reinsulate", installerCertified: true, validDays: 30 as const,
  changes: quoteChangeRows({ estimate: { areaM2: 120, removal: false, price: 1918 }, quote: { areaM2: 137, removal: true, price: 2188 } }),
};
emails["07-your-quote-is-ready"] = renderOwnerQuoteEmail({ ...quote, v4: true });
emails["08-quote-reminder-day-3"] = renderQuoteReminderEmail({ ...quote, kind: "day3" });
emails["09-quote-reminder-2-days-before-expiry"] = renderQuoteReminderEmail({ ...quote, kind: "expiry" });
const acc = { installerFirstName: "Sam", ownerName: "Sarah Brown", address: "12 Example St, Box Hill", jobNumber: "HV-1234", jobUrl: "https://portal.homeinsulationvictoria.com.au/field/EXAMPLE", useV2: true };
emails["10-owner-accepted-to-installer-office-books"] = renderInstallerAcceptedEmail({ ...acc, whoBooks: "office" });
emails["11-owner-accepted-to-installer-electrician-books"] = renderInstallerAcceptedEmail({ ...acc, whoBooks: "electrician", electricianName: "Sparky Electrical" });
emails["12-spot-saved"] = renderSpotSavedEmail({ firstName: "Sarah", rebate: 2380, suburb: "Box Hill", shortAddress: "12 Example St, Box Hill", myJobUrl: link, optOutUrl: unsub,
  estimate: { gross: 3798, customer: 2188, areaM2: 137, address: "12 Example St, Box Hill VIC 3128", calculatorUrl: "https://estimate.homeinsulationvictoria.com.au/" } });
const index: string[] = [];
for (const [name, m] of Object.entries(emails)) {
  writeFileSync(`${OUT}/${name}.html`, m.html);
  writeFileSync(`${OUT}/${name}.txt`, `Subject: ${m.subject}\n\n${m.text}\n`);
  index.push(`<li><a href="${name}.html">${name}</a> - ${m.subject.replace(/</g, "&lt;")}</li>`);
}

const texts: [string, string][] = [
  ["It's your turn (area batch send)", spotReleasedText("Sarah", `${link}?screen=taps`)],
  ["It's your turn (day-2 reminder)", spotReleasedText("Sarah", `${link}?screen=taps`, true)],
  ["Installer will call you", held(ownerWillCallText("Sarah", office))],
  ["You're booked (Ready Check)", (held(ownerBookedNotice({ kind: "ready_check", firstName: "Sarah", startIso: start, whoName: "Sam", business: office, changed: false })) as { sms: string }).sms],
  ["See you tomorrow (Ready Check)", held(visitTomorrowText({ kind: "ready_check", time: "9:00am", business: office }))],
  ["See you tomorrow (safety check)", held(visitTomorrowText({ kind: "piesa", time: "9:00am", business: office }))],
  ["See you tomorrow (install)", held(visitTomorrowText({ kind: "install", time: "9:00am", business: office }))],
  ["Your quote is ready (unchanged)", `Home Insulation Victoria: ${ownerQuoteSms("Sarah", `${link}?screen=quote`)}`],
  ["Quote reminder, day 3 (wording unchanged, 'held until')", `Home Insulation Victoria: ${quoteReminderDay3Text({ firstName: "Sarah", rebate: 1610, link: `${link}?screen=quote` })}`],
  ["Quote reminder, 2 days before expiry (wording unchanged)", `Home Insulation Victoria: ${quoteReminderExpiryText({ firstName: "Sarah", rebate: 1610, heldUntilIso: "2026-12-10T12:59:59Z", link: `${link}?screen=quote` })}`],
  ["Spot saved", spotSavedText("Sarah", "$2,380")],
  ["Rental questions, installer's own customer", ownCustomerRentalTapsText({ firstName: "Sarah", installer: "Reinsulate", link: rentalOnlyLink(quickTapsLink(link)) })],
];
writeFileSync(`${OUT}/texts.txt`, texts.map(([t, b]) => `## ${t}\n${b}\n(${b.length} characters)\n`).join("\n"));
index.push(`<li><a href="texts.txt">texts.txt</a> - every changed text</li>`);

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const sec = (title: string, rows: [string, string][]) => `<h2>${esc(title)}</h2>${rows.map(([k, v]) => `<div class="row"><b>${esc(k)}</b><p>${esc(v)}</p></div>`).join("")}`;
const pages = [
  sec("Quote page (My job, screen=quote)", [
    ["Heading", P2.title("Sarah")], ["Sub", P2.sub({ address: "12 Example St, Box Hill", measuredOn: "28 October", heldUntil: null })],
    ["Valid line (30-day quotes)", quoteValidLine(new Date("2026-12-10T12:59:59Z"))],
    [QUOTE_CHANGES_HEADING, `Ceiling size: estimate 120 m², quote 137 m². Old insulation removal: estimate No, quote Yes. Your price: estimate $1,918, quote $2,188. ${QUOTE_CHANGES_FOOTNOTE}`],
    ["Not included", P2.notIncluded], [P2.twoTicks, ""], ["Tick 1", P2.tick1], ["Documents note", P2.attachedNote],
    ["Links", `${P2.agreementLink}  ${P2.paymentTermsLink}  ${P2.rightsLink}`], ["Tick 2", P2.tick2], ["How you pay", P2.howYouPay], ["Timing", P2.timing],
    ["Name box", `${P2.signLabel} - ${P2.signSub}`], ["Button", P2.button("$349")], ["Locked hint", P2.lockHint],
  ]),
  sec("Quick taps (after 'It's your turn')", [
    ["Go-ahead tap (consent current)", quickTapsGoLabel({ installer: "Reinsulate", consentCurrent: true })],
    ["Go-ahead tap (consent older than 3 months)", quickTapsGoLabel({ installer: "Reinsulate", consentCurrent: false })],
    ["Pass screen", quickTapsPassLine("Reinsulate")], ["No thanks", QUICK_TAPS_COPY.outcome.no_thanks],
    ["Rental: who", `${RENTAL_TAPS.whoTitle}  [${RENTAL_TAPS.whoOptions.join("] [")}]`],
    ["Rental: their details", `${RENTAL_TAPS.detailsTitle}: ${RENTAL_TAPS.name} / ${RENTAL_TAPS.mobile} / ${RENTAL_TAPS.email}`],
    ["Rental: done", RENTAL_DONE_LINE],
  ]),
];
writeFileSync(`${OUT}/pages.html`, `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=430"><title>Part 3 page wording</title><style>body{font:15px/1.45 system-ui,sans-serif;max-width:430px;margin:0 auto;padding:16px;color:#1c2333}h2{font-size:18px;border-bottom:2px solid #0A5C36;padding-bottom:6px;margin-top:28px}.row{margin:12px 0}.row b{display:block;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#5B6478}.row p{margin:2px 0 0}</style><h1>Part 3 page wording (430px)</h1><p>Built from the same copy the pages read. Not screenshots.</p>${pages.join("")}`);
index.push(`<li><a href="pages.html">pages.html</a> - quote page and quick taps wording</li>`);
writeFileSync(`${OUT}/index.html`, `<!doctype html><meta charset="utf-8"><title>Part 3 samples</title><h1>Part 3 samples (3 Nov 2026)</h1><p>Rendered with every Part 3 approval flag treated as on. Nothing was sent.</p><ul>${index.join("")}</ul>`);
console.log(`wrote ${Object.keys(emails).length} emails, texts.txt, pages.html, index.html to ${OUT}`);
