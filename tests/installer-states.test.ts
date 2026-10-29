// Every approved installer STATE (Jo 24 Oct 2026, decisions 234–237) has one pure state → view rule. These tests pin the
// approved words for each state; docs/INSTALLER_STATES_PROOF.md maps state → route → server function → this file.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  allocationSheet, completeView, couldntGetInSheet, dayChecks, dayNext, electricianRow, installRow, jobNext, leadInstallerDeclaration, moneyJobDetail, needsFinishingList,
  NOT_FOR_ME_SHEET, NOT_FOR_ME_SHEET_ELECTRICIAN, OFFER_LABEL, offerAcceptedView, ownerReadyLine, paidByMonth, quoteNextWords, quoteStatusRow, signRebateChecks, signRebateThen, whatWeKnow, type JobNextFacts,
} from "../src/lib/installer-screens.core";
import { HOME_EMPTY, homeIsEmpty, monthStripWords, offerPanelWords, offersListView } from "../src/lib/installer-home.core";
import { QUOTE_DECLINED_LINE, QUOTE_HELD_LINE, QUOTE_SENT_LINE } from "../src/lib/installer-quote-status.core";
import { ADD_JOB_OFFLINE_NOTE, addedView, errorSummary, fieldErrors } from "../src/lib/add-job-flow.core";
import { PICK_ADDRESS } from "../src/lib/onsite-ready-check.core";
import { AGREEMENT_COVERS, GUIDE_STEPS, TEAM_ADD_SHEET, TEAM_LOGIN, bankOnFileRows, escNoticeRowLine, signedOnLine, teamCountLine } from "../src/lib/trade-view.core";

const base: JobNextFacts = {
  channel: "hivic_sourced", stage: "installation_scheduling", ownerFirstName: "Helen", formLinked: true, formCompleted: true, quoteLine: "Waiting on owner: quote accepted – waiting for owner's payment",
  needsFinishing: null, readyCheckTurn: "booked", readyCheckBookedAt: "2026-10-19T20:30:00Z", installTurn: "not_ready", installBookedAt: null,
  installDeadline: null, installDaysLeft: null, clearedOn: null, installFormComplete: false, installationRecorded: false, rebateSigned: false,
};

test("B6: one accepted label, one new-offer label", () => {
  expect(OFFER_LABEL).toEqual({ accepted: "Job accepted", new: "New job offer" });
  expect(offerAcceptedView({ ownerFirstName: null, suburb: null, jobNumber: null, times: [] }).pill).toBe(OFFER_LABEL.accepted);
  const page = readFileSync("src/routes/_authenticated/field.offer.$offerId.tsx", "utf8");
  for (const gone of ['"Booked"', "You've taken this job", "Job accepted · times sent", '"New job"', 'took ? "Job accepted"']) expect(page).not.toContain(gone);
  expect(page.match(/OFFER_LABEL\.accepted/g)?.length).toBe(2);
  expect(page).toContain("pill={OFFER_LABEL.new}");
});

describe("M1 states", () => {
  test("empty (new installer): the approved empty lines, Add a job under Action needed, $0 strip", () => {
    expect(homeIsEmpty({ offers: 0, coming: 0, action: 0, progress: 0, done: 0 })).toBe(true);
    expect(homeIsEmpty({ offers: 0, coming: 0, action: 1, progress: 0, done: 0 })).toBe(false);
    expect(HOME_EMPTY.action).toBe("Nothing needs you right now. When we send you a job, or you add your own, it shows here.");
    expect(HOME_EMPTY.actionButton).toBe("Add a job");
    expect(monthStripWords({ jobs: 0, paid: 0 })).toEqual({ installs: "No installs done yet", paid: "$0 paid" });
  });
  test("more offers: 'Job offers · 3' lists every open offer with Owner says / No size yet, the 24-hour note and the Coming up fold", () => {
    const offers = [{ id: "a", suburb: "Glen Waverley", areaM2: 120, expiresAt: "x" }, { id: "b", suburb: "Mulgrave", areaM2: null, expiresAt: "y" }, { id: "c", suburb: "Clayton South", areaM2: 95, expiresAt: null }];
    const v = offersListView(offers, (e) => (e ? `Closes in ${e}` : null))!;
    expect(v.heading).toBe("Job offers · 3");
    expect(v.rows.map((r) => r.detail)).toEqual(["Owner says ~120 m² · Home Insulation Victoria lead", "No size yet · Home Insulation Victoria lead", "Owner says ~95 m² · Home Insulation Victoria lead"]);
    expect(v.rows[1]!.closes).toBe("Closes in y");
    expect(v.note).toBe("Each offer is only for you and stays open 24 hours. Open one to offer the owner 3 Ready Check times.");
    expect("comingUpFold" in v).toBe(false);
    expect(offersListView(offers.slice(0, 1), () => null)).toBeNull();
    expect(offerPanelWords({ suburb: "Glen Waverley", areaM2: 120 }, 3).eyebrow).toBe("3 new job offers");
  });
});

describe("M2 states", () => {
  test("own customer before the Ready Check: arrange it directly, time entry panel", () => {
    const own: JobNextFacts = { ...base, channel: "installer_sourced", stage: "ready_check_ready_to_schedule", ownerFirstName: "Mei", formCompleted: false, quoteLine: null, readyCheckTurn: null, readyCheckBookedAt: null };
    expect(jobNext(own)).toMatchObject({ panel: "ready_check_set_time", title: "Do the Ready Check and fill in the Mitti form", sub: "You arrange the visit with Mei directly. Measurements, photos and product all go in the form.", yours: true });
    expect(quoteStatusRow(null, { formLinked: true }).label).toBe("Prepared once you press Complete in Mitti");
  });
  test("needs finishing: 'Add 4 things in Mitti' with the approved list from ready-check-basics", () => {
    const na = "Needs finishing: price, owner email, ceiling area, insulation product on the Mitti form";
    expect(needsFinishingList(na)).toEqual(["Your price", "The owner's email", "The ceiling area", "The insulation product"]);
    expect(needsFinishingList("Needs finishing: owner mobile/email/permission on the Mitti form")).toEqual(["The owner's mobile", "The owner's email", "The owner's permission to contact"]);
    const n = jobNext({ ...base, channel: "installer_sourced", ownerFirstName: "Mei", formCompleted: false, quoteLine: null, needsFinishing: "You: add your price in Mitti", needsFinishingItems: needsFinishingList(na), readyCheckBookedAt: "2026-10-25T20:30:00Z" });
    expect(n).toMatchObject({ panel: "mitti_form", title: "Add 4 things in Mitti", sub: "Ready Check done Mon 26 Oct at 7:30am. The form is still missing:", yours: true, note: "Press Complete only when it's fully finished — that sends Mei their quote." });
    expect(n.items).toEqual(["Your price", "The owner's email", "The ceiling area", "The insulation product"]);
    expect(quoteStatusRow(null, { needsFinishing: true, formLinked: true }).label).toBe("Not drafted yet · waiting on the form");
  });
  test("quote sent / held / declined: 'Nothing for you' with recorded dates only", () => {
    expect(quoteNextWords({ quoteLine: QUOTE_SENT_LINE, quoteSentAt: "2026-10-21T22:00:00Z" }, "Helen")).toMatchObject({ title: "Nothing for you — Helen has the quote", sub: "We sent Helen the quote on Thu 22 Oct. We'll tell you when Helen accepts. Then we arrange the Pre Insulation Electrical Safety Assessment (PIESA).", yours: false });
    expect(quoteNextWords({ quoteLine: QUOTE_HELD_LINE, formCompletedAt: "2026-10-20T22:00:00Z" }, "Helen")).toMatchObject({ title: "Nothing for you — the office is checking the quote", sub: "You pressed Complete in Mitti on Wed 21 Oct. We check every quote before it goes to the owner. If we need anything we'll text you." });
    expect(quoteNextWords({ quoteLine: QUOTE_DECLINED_LINE, quoteDeclinedAt: "2026-10-23T22:00:00Z" }, "Helen")).toMatchObject({ title: "Nothing for you — Helen declined the quote", sub: "Declined Sat 24 Oct. The office may follow up with Helen. If the job comes back, it shows in Action needed." });
    expect(quoteNextWords({ quoteLine: QUOTE_DECLINED_LINE }, "the owner")!.sub).toBe("The office may follow up with the owner. If the job comes back, it shows in Action needed.");
    expect(quoteNextWords({ quoteLine: "something else" }, "Helen")).toBeNull();
    // jobNext routes through the same words
    expect(jobNext({ ...base, quoteLine: QUOTE_SENT_LINE, quoteSentAt: "2026-10-21T22:00:00Z" }).title).toBe("Nothing for you — Helen has the quote");
    expect(quoteStatusRow({ sent: true, accepted: false, declined: false, held: false, formCompleted: true, sentAt: "2026-10-21T22:00:00Z" }).label).toBe("Sent Thu 22 Oct · waiting on the owner");
    expect(quoteStatusRow({ sent: false, accepted: false, declined: false, held: true, formCompleted: true }).label).toBe("Being checked by the office");
    expect(quoteStatusRow({ sent: true, accepted: false, declined: true, held: false, formCompleted: true, declinedAt: "2026-10-23T22:00:00Z" }).label).toBe("Declined Sat 24 Oct");
  });
  test("PIESA booked: nothing for the installer until clearance; electrician row names the visit", () => {
    const n = jobNext({ ...base, piesaBooking: { electrician: "Sam Lee", start: "2026-10-28T22:00:00Z" } });
    expect(n).toMatchObject({ panel: "waiting", title: "Nothing for you — Pre Insulation Electrical Safety Assessment (PIESA) booked", sub: "Sam Lee (Home Insulation Victoria electrician) does the PIESA on Thu 29 Oct at 9am. Once it's cleared, you offer Helen 3 install days within 30 days.", yours: false });
    expect(jobNext({ ...base, piesaBooking: { electrician: "Sam Lee", start: "2026-10-28T22:00:00Z" }, clearedOn: "2026-10-28T23:00:00Z", installTurn: "installer_to_offer" }).panel).toBe("offer_install_days");
    expect(electricianRow({ name: "Sam Lee", piesaBookedAt: "2026-10-28T22:00:00Z", piesaPassedOn: null, fixesNote: null })).toEqual({ label: "Electrician", value: "Sam Lee · PIESA Thu 29 Oct at 9am" });
    expect(electricianRow({ name: null, piesaBookedAt: null, piesaPassedOn: "2026-10-28T23:00:00Z", fixesNote: "downlight covers needed on the day" })!.value).toBe("PIESA passed Thu 29 Oct · downlight covers needed on the day");
    expect(electricianRow({ name: null, piesaBookedAt: null, piesaPassedOn: null, fixesNote: null })).toBeNull();
  });
  test("install booked: exact time, days left; nothing about the rebate form", () => {
    const n = jobNext({ ...base, stage: "installation_booked", installTurn: "booked", installBookedAt: "2026-10-26T20:30:00Z", installDeadline: "2026-11-21", installDaysLeft: 25 });
    expect(n).toMatchObject({ panel: "install_booked", title: "Install booked · Tue 27 Oct at 7:30am", sub: "Install by Sat 21 Nov · 25 days left.", yours: false });
    expect(JSON.stringify(n)).not.toMatch(/rebate/i);
    expect(n.ownerReady ?? null).toBeNull(); // nothing read → nothing shown, never a guess
  });
  test("install booked: owner consent + 10% deposit line from recorded facts only (decision 251), no amounts", () => {
    const booked = { ...base, stage: "installation_booked", installTurn: "booked" as const, installBookedAt: "2026-10-26T20:30:00Z" };
    expect(jobNext({ ...booked, ownerReady: { consent: "signed", deposit: "paid" } }).ownerReady).toEqual({ text: "Consent signed ✓ · 10% deposit paid ✓", done: true });
    expect(jobNext({ ...booked, ownerReady: { consent: "signed", deposit: "waiting" } }).ownerReady).toEqual({ text: "Consent signed ✓ · 10% deposit not paid yet", done: false });
    expect(jobNext({ ...booked, ownerReady: { consent: "waiting", deposit: "paid" } }).ownerReady).toEqual({ text: "Consent not signed yet · 10% deposit paid ✓", done: false });
    expect(jobNext({ ...booked, ownerReady: { consent: "waiting", deposit: "waiting" } }).ownerReady!.text).toBe("Consent not signed yet · 10% deposit not paid yet");
    // Unknown parts are left out (no consent record yet / no invoice to read), never shown as done.
    expect(ownerReadyLine({ consent: "signed", deposit: null })).toEqual({ text: "Consent signed ✓", done: false });
    expect(ownerReadyLine({ consent: null, deposit: "paid" })).toEqual({ text: "10% deposit paid ✓", done: false });
    expect(ownerReadyLine({ consent: null, deposit: null })).toBeNull();
    expect(ownerReadyLine(null)).toBeNull();
    // Only the install-booked panel carries it.
    expect(jobNext({ ...base, installTurn: "owner_to_answer", ownerReady: { consent: "signed", deposit: "paid" } }).ownerReady).toBeUndefined();
    for (const c of ["signed", "waiting", null] as const) for (const d of ["paid", "waiting", null] as const) expect(JSON.stringify(ownerReadyLine({ consent: c, deposit: d }))).not.toMatch(/\$|\d{3,}|price|total/i);
  });
  test("install booked: the server reads consent + deposit business-scoped and returns states only", () => {
    const srv = readFileSync("src/lib/trade-view.server.ts", "utf8");
    const fn = srv.slice(srv.indexOf("async function ownerReadyFacts"), srv.indexOf("export async function tradeJobPage"));
    expect(fn).toContain('from("owner_esc_consents")');
    expect(fn).toContain('isStepPaid(v.steps, "install_deposit")');
    expect(fn).not.toMatch(/amountCents|outstandingCents|plan\.|ledger/);
    const page = srv.slice(srv.indexOf("export async function tradeJobPage"), srv.indexOf("export async function tradeDayExtras"));
    expect(page.indexOf("requireTradeJob(userId, jobId)")).toBeLessThan(page.indexOf("ownerReadyFacts(jobId)"));
    expect(page).toContain('inBook?.status === "confirmed" ? await ownerReadyFacts(jobId)');
  });
  test("sign the rebate form after Mitti Complete (decision 213): approved sub, recorded ticks only, Install row", () => {
    const n = jobNext({ ...base, stage: "installation_booked", installTurn: "booked", installBookedAt: "2026-10-26T20:30:00Z", installFormComplete: true, installationRecorded: true, installFormCompletedAt: "2026-10-27T03:40:00Z", evidenceChecked: true, crew: ["Raj Kumar", "Deep Singh"] });
    expect(n).toMatchObject({ panel: "sign_rebate", title: "Sign the rebate form", sub: "Your part of the VEEC assignment form (Part B): you declare the install facts as the lead installer. Type your name and tap Sign.", yours: true });
    expect(n.checks).toEqual(["Install form Complete · Tue 27 Oct at 2:40pm", "Photos and videos checked by the portal", "Crew on the PIISA: Raj Kumar, Deep Singh"]);
    expect(signRebateChecks({ installFormCompletedAt: null, evidenceChecked: false, crew: [] })).toEqual([]);
    expect(installRow({ doneAt: "2026-10-26T21:00:00Z", areaM2: 137.6, removalM2: 40 })).toBe("Done Tue 27 Oct · 137.6 m² · 40 m² removed");
    expect(installRow({ doneAt: null, areaM2: 137.6, removalM2: 40 })).toBeNull();
  });
  test("complete: read-only summary, paperwork from recorded signatures, no owner contact", () => {
    const v = completeView({ jobNumber: "HV-3117", suburb: "Glen Waverley", channel: "hivic_sourced", completedAt: "2026-10-26T21:00:00Z", product: "Bradford Gold R5.0", areaM2: 137.6, removalM2: 40, crew: ["Raj Kumar", "Deep Singh"],
      pay: { amount: 2890, state: { kind: "coming", on: "2026-11-02T21:00:00Z" } }, piisaSignedAt: "2026-10-26T21:00:00Z", installerSignedAt: "2026-10-26T22:00:00Z", ownerSignedAt: "2026-10-27T22:00:00Z", apSignedAt: "2026-10-28T22:00:00Z" });
    expect(v.heading).toBe("HV-3117 · Glen Waverley");
    expect(v.sub).toBe("Home Insulation Victoria lead · Job complete Tue 27 Oct");
    expect(v.done).toEqual({ title: "Nothing more to do", body: "Rebate form signed by you and the owner. Part A of the rebate form is signed. Owner contact details are no longer shown." });
    expect(v.summary).toEqual([["Installed", "Bradford Gold R5.0 · 137.6 m²"], ["Removed", "40 m²"], ["Crew", "Raj Kumar, Deep Singh"], ["Your pay", "$2,890 · Coming Tue 3 Nov"]]);
    expect(v.paperwork).toEqual([["PIISA", "Signed Tue 27 Oct"], ["Rebate form Part B", "Signed Tue 27 Oct"], ["Owner's part", "Signed Wed 28 Oct"]]);
    expect(completeView({ jobNumber: null, suburb: null, channel: null, completedAt: null, product: null, areaM2: null, removalM2: null, crew: [], pay: null, piisaSignedAt: null, installerSignedAt: null, ownerSignedAt: null, apSignedAt: null }).paperwork[2]).toEqual(["Owner's part", "Not signed yet"]);
    expect(JSON.stringify(v)).not.toMatch(/0412|@|Bogong/);
  });
  test("change allocation sheet (decision 161): install days only CII-cleared, 'Allocate to Raj'", () => {
    const s = allocationSheet({ kind: "install", visitAt: "2026-10-26T20:30:00Z", suburb: "Glen Waverley", chosen: "raj", options: [
      { workerId: "deep", name: "Deep Singh", role: "owner", mobile: "0412 000 111", mittiLinked: true, allowed: true, reason: null, picked: false },
      { workerId: "raj", name: "Raj Kumar", role: "installer", mobile: "0433 222 333", mittiLinked: true, allowed: true, reason: null, picked: false },
      { workerId: "tom", name: "Tom Brown", role: "installer", mobile: "0455 444 555", mittiLinked: false, allowed: false, reason: "CII being checked.", picked: false },
    ] });
    expect(s.title).toBe("Who does the install day?");
    expect(s.sub).toBe("Tue 27 Oct at 7:30am · Glen Waverley. The Mitti install form and the 6:30am text go to this person.");
    expect(s.rows.map((r) => [r.line, r.status, r.tone])).toEqual([["owner · 0412 000 111 · Mitti ✓", "CII cleared", "green"], ["installer · 0433 222 333 · Mitti ✓", "CII cleared", "green"], ["installer · 0455 444 555 · Mitti not set", "CII being checked · can't do installs", "rose"]]);
    expect(s.button).toBe("Allocate to Raj");
    expect(allocationSheet({ kind: "install", visitAt: null, suburb: null, chosen: "tom", options: s.rows.map((r) => ({ workerId: r.workerId, name: r.name, mobile: null, allowed: r.allowed, reason: null, picked: false })) }).button).toBeNull();
    expect(allocationSheet({ kind: "ready_check", visitAt: null, suburb: null, chosen: null, options: [] }).title).toBe("Who does the Ready Check?");
  });
  test("decision 277: no Messages section or quick replies on the installer job page; headings navy, labels readable", () => {
    const page = readFileSync("src/routes/_authenticated/field.$jobId.tsx", "utf8");
    expect(page).not.toMatch(/InstallerMessages|QUICK_ACTIONS|title="Messages"|Write a message/);
    expect(page).toMatch(/<ContactButtons phone=/); // the installer still contacts the owner by Call / Text / Directions
    const core = readFileSync("src/lib/messaging.core.ts", "utf8");
    expect(core).not.toMatch(/installer:\s*\[|sent you 3 days|Running 15 min late/);
    const kit = readFileSync("src/components/trade/installer-kit.tsx", "utf8");
    expect(kit).toMatch(/uppercase tracking-\[1\.1px\] text-ink/); // Group heading
    const css = readFileSync("src/styles.css", "utf8");
    expect(css).toMatch(/\.installer-redesign \{ --hiv-sub: #4b5a7c;/);
    const mockups = ["docs/templates/installer/portal/M2-job-page.html", ...["change-allocation", "complete", "install-booked", "needs-finishing", "own-before-ready-check", "piesa-booked", "quote-declined", "quote-held", "quote-sent", "sign-rebate-form"].map((s) => `docs/templates/installer/portal/states/M2-${s}.html`)];
    for (const f of mockups) {
      const html = readFileSync(f, "utf8");
      expect(html, f).not.toMatch(/>Messages<|Write a message|sent you 3 days|Running 15 min late|I'm on my way/);
      expect(html, f).not.toMatch(/text-transform:uppercase;color:#5A6785/);
      expect(html, f).not.toMatch(/font-size:15px;"><span style="color:#5A6785;/);
    }
  });
});

describe("M4 states", () => {
  test("Ready Check day (our lead): pricing tick is the third check, approved Next words, What we know", () => {
    expect(dayChecks({ kind: "ready_check", channel: "hivic_sourced" })).toEqual(["Location on (photos are geotagged)", "Phone charged", "I will not discuss pricing with the owner"]);
    expect(dayChecks({ kind: "install", channel: "hivic_sourced" })[2]).toBe("Power off before you go in the roof");
    expect(dayNext({ kind: "ready_check", channel: "hivic_sourced", installFormComplete: false, rebateSigned: false, ownerFirstName: "Helen" })).toMatchObject({ title: "Do the Ready Check in Mitti", sub: "Measure every ceiling area (length × width), photos, existing insulation, access and hazards. We price Helen's quote from your agreed rates.", button: "Open Mitti form" });
    expect(whatWeKnow({ areaM2: 120, insulation: "some" })).toEqual([["Owner says", "~120 m² · some insulation"], ["Ready Check", "Free visit, as in your agreement"], ["Your pay", "Agreed rates × measured area, after the install"]]);
    expect(whatWeKnow({ areaM2: null, insulation: null })[0]).toEqual(["Owner says", "No details yet"]);
    expect(JSON.stringify(whatWeKnow({ areaM2: 120, insulation: "none" }))).not.toMatch(/\$/);
  });
  test("couldn't get in on an install day (decisions 214/215): owner told, nobody charged, 30-day end date", () => {
    expect(couldntGetInSheet({ kind: "install", ownerFirstName: "Anita", installDeadline: "2026-11-21" })).toEqual({ title: "Couldn't get in?", sub: "Pick what happened. Anita is texted and emailed straight away, nobody is charged for the trip, and you'll be asked to offer 3 new install days. The 30-day clock keeps running (ends Sat 21 Nov).", cancel: "Cancel" });
    expect(couldntGetInSheet({ kind: "ready_check", ownerFirstName: null, installDeadline: null }).sub).toBe("Pick what happened. We'll take it from here.");
  });
  test("sign the rebate form on the day: wrap line, declaration from facts only, Then rows", () => {
    expect(dayNext({ kind: "install", channel: "hivic_sourced", installFormComplete: true, rebateSigned: false }).sub).toBe("That's a wrap. One last step: your part of the VEEC assignment form (Part B).");
    expect(leadInstallerDeclaration({ address: "12 Wattle Grove, Clayton", installedOn: "2026-10-26T21:00:00Z", product: "Bradford Gold R5.0 ceiling batts", areaM2: 137.6, removalM2: 40 }))
      .toBe("I was the lead installer at 12 Wattle Grove, Clayton on Tue 27 Oct 2026. Bradford Gold R5.0 ceiling batts, 137.6 m², 40 m² removed. The information in Section 2 is true and correct.");
    expect(leadInstallerDeclaration({ address: null, installedOn: null, product: null, areaM2: null, removalM2: null })).toBe("I was the lead installer. The information in Section 2 is true and correct.");
    expect(signRebateChecks({ installFormCompletedAt: "2026-10-27T03:40:00Z", evidenceChecked: true, crew: [], piisaSigned: true, swmsComplete: true })).toEqual(["Install form Complete · Tue 27 Oct at 2:40pm", "SWMS and PIISA signed", "Photos and videos checked by the portal"]);
    expect(signRebateChecks({ installFormCompletedAt: null, evidenceChecked: false, crew: [], piisaSigned: true })).toEqual(["PIISA signed"]);
    expect(signRebateThen("Anita", 2890, "hivic_sourced")).toEqual([["Owner", "Anita signs their part by secure link"], ["Office", "Does the final check; Part A of the form signs itself"], ["Your pay", "$2,890 · within 7 days of our approval"]]);
    expect(signRebateThen(null, null, "installer_sourced")).toHaveLength(2);
  });
});

describe("M5 states", () => {
  test("accepted: times sent, owner picking, address only once booked", () => {
    const v = offerAcceptedView({ ownerFirstName: null, suburb: "Glen Waverley", jobNumber: "HV-3117", times: ["2026-10-26T05:00:00Z", "2026-10-27T20:30:00Z", "2026-10-30T01:30:00Z"] });
    expect(v.pill).toBe("Job accepted");
    expect(v.line2).toBe("HV-3117 · Home Insulation Victoria lead");
    expect(v.next.title).toBe("Nothing for you — the owner is picking a time");
    expect(v.next.sub).toBe("We've sent the owner your 3 times. You get a text with the day, time and address as soon as they pick one. If none suit, they suggest other days and it comes back to you.");
    expect(v.times).toEqual(["Mon 26 Oct at 4pm", "Wed 28 Oct at 7:30am", "Fri 30 Oct at 12:30pm"]);
    expect(v.owner).toEqual([["Name", "Shown once a time is booked"], ["Address", "Shown once a time is booked"]]);
    expect(offerAcceptedView({ ownerFirstName: "Helen", suburb: null, jobNumber: null, times: [] }).next.sub).toContain("We've sent Helen your 3 times");
  });
  test("not for me: one confirmation, goes back to the office, nothing counts against you", () => {
    expect(NOT_FOR_ME_SHEET).toEqual({ title: "Not for me?", body: "The offer goes back to the office to pick another installer. It won't come back to you. Nothing counts against you.", yes: "Yes, not for me", keep: "Keep the offer" });
    const page = readFileSync("src/routes/_authenticated/field.offer.$offerId.tsx", "utf8");
    expect(page).toContain("data-not-for-me-sheet");
    expect(page).toContain("sheet.keep");
  });
  test("B7: electrician Not for me asks first, with electrician words", () => {
    expect(NOT_FOR_ME_SHEET_ELECTRICIAN).toEqual({ title: "Not for me?", body: "The offer goes back to the office to pick another electrician. It won't come back to you.", yes: "Yes, not for me", keep: "Keep the offer" });
    const page = readFileSync("src/routes/_authenticated/field.offer.$offerId.tsx", "utf8");
    expect(page).toContain("sheet={NOT_FOR_ME_SHEET}");
    expect(page.match(/sheet=\{NOT_FOR_ME_SHEET_ELECTRICIAN\}/g)?.length).toBe(1);
    expect(page.match(/trigger="link"/g)?.length).toBe(1);
    expect(page.match(/data-not-for-me-sheet/g)?.length).toBe(1);
    expect(page).not.toMatch(/data-not-for-me onClick=\{\(\) => send\(/);
  });
});

describe("M6 states", () => {
  const paid = [
    { jobId: "a", jobNumber: "HV-3041", suburb: "Notting Hill", surname: "Ng", amount: 2420, paidOn: "2026-10-22T20:00:00Z", doneAt: "2026-10-13T21:00:00Z", channel: "installer_sourced" },
    { jobId: "b", jobNumber: "HV-3022", suburb: "Oakleigh", surname: "Lo", amount: 1760, paidOn: "2026-10-16T20:00:00Z", doneAt: "2026-10-07T21:00:00Z", channel: "hivic_sourced" },
    { jobId: "c", jobNumber: "HV-2981", suburb: "Clayton", surname: "Pa", amount: 2310, paidOn: "2026-09-28T20:00:00Z", doneAt: "2026-09-23T21:00:00Z", channel: "hivic_sourced" },
  ];
  test("all paid grouped by month with totals, newest first", () => {
    const g = paidByMonth(paid);
    expect(g.map((m) => m.label)).toEqual(["October · $4,180", "September · $2,310"]);
    expect(g[0]!.rows.map((r) => r.jobNumber)).toEqual(["HV-3041", "HV-3022"]);
    expect(paidByMonth([])).toEqual([]);
  });
  test("job detail (decision 109): own customer waits for approval AND the owner's balance; timeline from recorded facts only", () => {
    const v = moneyJobDetail({ jobNumber: "HV-3102", suburb: "Wheelers Hill", channel: "installer_sourced", doneAt: "2026-10-21T21:00:00Z", amount: 3180, state: { kind: "coming", on: "2026-10-30T20:00:00Z" }, accountEnding: "4471",
      product: "Bradford Gold R5.0", areaM2: 148, removalM2: null, crew: ["Deep Singh", "Raj Kumar"], installerSignedAt: "2026-10-21T22:00:00Z", ownerSignedAt: "2026-10-21T23:00:00Z", apApprovedAt: "2026-10-23T22:00:00Z", ownerPaidInFullAt: "2026-10-23T23:00:00Z" });
    expect(v.heading).toBe("HV-3102 · Wheelers Hill");
    expect(v.sub).toBe("Your customer · Install Thu 22 Oct");
    expect(v.pay).toBe("$3,180");
    expect(v.payNote).toBe("Inc GST · paid to the account ending 4471");
    expect(v.work).toEqual([["Installed", "Bradford Gold R5.0 · 148 m²"], ["Removed", "None"], ["Crew", "Deep Singh, Raj Kumar"]]);
    expect(v.timeline).toEqual([["Install done", "Thu 22 Oct"], ["Rebate form signed", "Thu 22 Oct · you and the owner"], ["Office approved", "Sat 24 Oct"], ["Owner paid the balance", "Sat 24 Oct"], ["Pay due", "Sat 31 Oct · 7 days after both"]]);
    expect(v.footnote).toBe("Your customers are paid once the office approves the paperwork and the owner has paid their balance.");
    const lead = moneyJobDetail({ jobNumber: null, suburb: null, channel: "hivic_sourced", doneAt: null, amount: null, state: { kind: "checking" }, accountEnding: null, product: null, areaM2: null, removalM2: null, crew: [], installerSignedAt: null, ownerSignedAt: null, apApprovedAt: null, ownerPaidInFullAt: null });
    expect(lead.timeline).toEqual([]);
    expect(lead.pay).toBe("To be confirmed");
    expect(JSON.stringify(lead)).not.toMatch(/Owner paid the balance/);
  });
});

describe("M7 sub-page states", () => {
  test("team add sheet words", () => {
    expect(TEAM_ADD_SHEET).toMatchObject({ title: "Add a team member", bodyInstaller: "Email and mobile can wait. They sign their declarations by link, and we check their CII certificate, before they go on a job.", bodyElectrician: "Email and mobile can wait. They sign their declarations by link before they go on a job. Each electrician needs a current electrical licence.", name: "Full name", licence: "Electrical licence number", role: "Lead or Crew", lead: "Lead · can run install days", crew: "Crew · can't lead an install day", mobile: "Mobile (optional)", email: "Email (optional)", button: "Add to team", cancel: "Cancel" });
    expect(TEAM_LOGIN).toEqual({ button: "Ask the office to send a login", asked: "Asked the office. They'll send the login." });
    expect(teamCountLine(3)).toBe("3 people");
    expect(teamCountLine(1)).toBe("1 person");
  });
  test("agreement, bank, notice, guide words", () => {
    expect(AGREEMENT_COVERS).toHaveLength(4);
    expect(signedOnLine("2026-10-03T04:14:00Z")).toBe("Sat 3 Oct 2026, 2:14pm");
    expect(signedOnLine(null)).toBeNull();
    expect(bankOnFileRows({ account_name: "Reinsulate Pty Ltd", bsb: "063-123", account_number: "12344471" })).toEqual([["Account name", "Reinsulate Pty Ltd"], ["BSB", "063-xxx"], ["Account number", "•••• 4471"]]);
    expect(bankOnFileRows(null)).toBeNull();
    expect(escNoticeRowLine({ state: "acknowledged", at: "2026-10-03T03:14:00Z" })).toBe("Acknowledged 3 Oct 2026");
    expect(escNoticeRowLine({ state: "pending", at: null, linkSentAt: "2026-10-20T22:00:00Z", reminderAt: "2026-10-23T22:00:00Z" })).toBe("Not yet · link sent Wed 21 Oct, reminder Sat 24 Oct");
    expect(escNoticeRowLine({ state: "pending", at: null })).toBe("Not yet · no link sent");
    expect(GUIDE_STEPS.map((s) => s.title)).toEqual(["Get the job", "Ready Check", "PIESA", "Install days", "Install day"]);
  });
});

describe("M3 heavier Add a job (decision 237)", () => {
  test("one short red line per field from the existing validator messages; summary banner", () => {
    const e = fieldErrors(["Add the owner's first and last name — it goes on their quote", PICK_ADDRESS, "Check the email address", "Confirm the owner has given Home Insulation Victoria permission to contact them"]);
    expect(e).toEqual({ full_name: "Enter the owner's first and last name.", address: "Pick the address from the list.", email: "That doesn't look like an email address.", permission: "Tick this once the owner has agreed." });
    expect(fieldErrors(["Add the owner's mobile"]).phone).toBe("Enter the owner's mobile.");
    expect(fieldErrors(["Check the mobile — it should look like 0412 345 678"]).phone).toBe("That doesn't look like a mobile number.");
    expect(fieldErrors(["We can only take Victorian jobs — this one can't be added"]).address).toBe("We can only take Victorian jobs.");
    expect(fieldErrors(["Choose both the visit day and the arrival time, or leave both blank"]).visit).toBe("Choose both the visit day and the arrival time, or leave both blank.");
    expect(errorSummary(3)).toBe("3 things to fix before the job can be added.");
    expect(errorSummary(1)).toBe("1 thing to fix before the job can be added.");
    expect(errorSummary(0)).toBeNull();
    expect(ADD_JOB_OFFLINE_NOTE).toBe("Your typed details stay on your phone if the signal drops.");
  });
  test("Job added: tick header, Mitti card from the real form state, what we do now, two links", () => {
    const v = addedView({ jobNumber: "HV-3166", address: "18 Bogong Avenue, Glen Waverley", ownerName: "Helen Yang", phone: "0412 345 678", ownerFirstName: "Helen", booking: "confirmed", visit: { day: "2026-10-26", time: "07:30" }, state: { kind: "open", url: "https://m" } });
    expect(v.heading).toBe("Job added");
    expect(v.line1).toBe("HV-3166 · 18 Bogong Avenue, Glen Waverley");
    expect(v.line2).toBe("Helen Yang · 0412 345 678");
    expect(v.card).toEqual({ title: "Your Ready Check form is ready in Mitti", body: "Ready Check Mon 26 Oct at 7:30am — it's in your 6:30am text. Fill in as much as you can at the visit. Press Complete only when it's fully finished — that sends Helen their quote.", button: "Open Mitti form" });
    expect(v.steps).toEqual(["Nothing is sent to Helen until you press Complete.", "We prepare the quote from your Ready Check and the price you enter on the job page, plus our $349 fee.", "We arrange the electrical safety check once Helen accepts."]);
    expect(addedView({ jobNumber: null, address: "x", ownerName: "A B", phone: "", ownerFirstName: "A", booking: "none", visit: { day: "", time: "" }, state: { kind: "preparing", message: "soon" } }).card).toMatchObject({ title: "Your Ready Check form is being set up in Mitti", button: null });
    expect(addedView({ jobNumber: null, address: "x", ownerName: "A B", phone: "", ownerFirstName: "A", booking: "none", visit: { day: "", time: "" }, state: { kind: "retry", message: "No signal." } }).card).toMatchObject({ title: "Job added — form not ready yet", button: "Try again" });
  });
  test("the screen is the heavier design: two mist cards, 52px fields, 56px button, red summary", () => {
    const flow = readFileSync("src/components/trade/add-job-flow.tsx", "utf8");
    const fields = readFileSync("src/components/trade/customer-fields.tsx", "utf8");
    expect(flow).toContain("data-owner-card");
    expect(flow).toContain("data-visit-field");
    expect(flow).toContain("min-h-14");
    expect(flow).toContain("errorSummary(");
    expect(fields).toContain("min-h-[52px]");
    expect(fields).toContain("border-2");
    expect(fields).toContain("data-permission-row");
    expect(fields).toContain("✓ Address found");
  });
});
