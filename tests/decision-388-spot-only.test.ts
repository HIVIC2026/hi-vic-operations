// Decision 388 (Jo 25 Oct 2026, in capitals): "WE ARE SAVING SPOTS NOT OFFERING READY CHECKS". Process: "We save spots
// and then I will manually, slowly release one by one to a chosen installer while we staff." Everything an owner sees or
// receives BEFORE their spot is released is spot-only: no Ready Check, installer visit, times, measuring, quote timing,
// speed ("soon", "as soon as") or queue-jumping. Every pre-release renderer and constant is scanned here; reworded
// messages that had an approval flag are HELD until Jo approves docs/decision-388-spot-only-wording.md.
// Run: bun test tests/decision-388-spot-only.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PRE_RELEASE_FORBIDDEN, SPOT_PROCESS_STATEMENT, SPOT_RELEASE_LINE, preReleaseViolations } from "../src/lib/spot-only-copy.core";
import { O2_DONT_KNOW_INTRO, renderJoOutcomeEmail } from "../src/lib/jo-outcome-email.core";
import { renderSpotSavedEmail, renderSpotSavedSms } from "../src/lib/spot-saved-messages.core";
import { ESTIMATE_FOLLOWUP_APPROVED, ESTIMATE_FOLLOWUP_STEPS, renderEstimateFollowupEmail } from "../src/lib/estimate-followup.core";
import { blastMessage } from "../src/lib/save-spot-reminder-blast.core";
import { answerText, decideOwnerAutoReply, LONG_LIST, OWNER_EMAIL_AUTO_REPLY_APPROVED, renderOwnerAutoReplyEmail, type OwnerJobFacts } from "../src/lib/owner-email-auto-reply.core";
import { SPOT_SAVED_BODY } from "../src/lib/save-spot-offer.core";
import { PRELIMINARY_READY_CHECK } from "../src/lib/preliminary-save-spot.core";
import { READY_CHECK_BOOKING_CLOSED, SPOT_HELD_MESSAGE } from "../src/lib/ready-check-booking-access.core";
import { EXISTING_PRELIMINARY, REMOVAL_BUDGET_EMAIL_NOTE, removalNote } from "../src/lib/estimate-removal.core";
import { REMOVAL_UPTO_NOTE } from "../src/lib/estimate-removal-upto.core";
import { INSULATION_REVIEW_INVITATION } from "../src/lib/insulation-review.core";
import { P1 } from "../src/lib/owner-pages.core";
import { SPOT_SAVED_PROGRESS, ownerAction } from "../src/lib/owner-myjob.core";
import { stageWording } from "../src/lib/job-wording";
import { renderCoverageUnavailableEmail } from "../src/lib/coverage-email";
import { renderFollowupEmail } from "../src/lib/followup-email";
import { includedAndNotIncludedText, INCLUDED_CLOSING } from "../src/lib/email-kit.core";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";
import { INSULATION_DETAILS_REAL_SEND_APPROVED, SAVE_SPOT_REAL_SEND_APPROVED } from "../src/lib/hot-leads.core";
import { INSULATION_QUESTIONS_SEND_APPROVED } from "../src/lib/insulation-questions-campaign.core";
import { LAUNCH_COPY_APPROVED } from "../src/lib/launch-campaign.core";
import { AI_BUSINESS_RULES_PRE_RELEASE, aiReplyInstructions, buildAiReplyInput } from "../src/lib/ai-email-reply.core";
import { CUSTOMER_WHAT_COULD_CHANGE } from "../src/lib/customer-quote-system";

const clean = (label: string, text: string) => expect({ label, found: preReleaseViolations(text) }).toEqual({ label, found: [] });
const EST = "https://estimate.homeinsulationvictoria.com.au/estimate/tok";
const LINKS = { saveMySpotUrl: `${EST}/campaign`, uploadMediaUrl: `${EST}/video`, reviewResultUrl: EST, calculatorUrl: `${EST}/calculator` };
const HELEN = { firstName: "Helen", propertyAddress: "824 High Street Road, Glen Waverley VIC 3150", enquiryReference: "HV-TEST" };
const FIG = { veuRebate: 1610, customerTotal: 2188, totalBeforeRebate: 3798, installation: 3100, piesaFee: 349, apFee: 349, ceilingAreaM2: 137, areaEstimated: false };

describe("the rule itself", () => {
  test("Jo's process sentence and the release line are recorded verbatim", () => {
    expect(SPOT_PROCESS_STATEMENT).toBe("We save spots and then I will manually, slowly release one by one to a chosen installer while we staff.");
    expect(SPOT_RELEASE_LINE).toBe("Spots are released in the order they were saved. We'll be in touch when your spot is released.");
  });
  test("the scanner catches every banned promise", () => {
    for (const bad of ["your free Ready Check", "an installer will offer you times", "they'll offer you times", "We measure your roof space", "a free onsite check",
      "we'll text you as soon as an installer is free", "Spots open soon", "we'll call shortly", "booked this week", "Want to jump the queue?", "so you could move up"])
      expect({ bad, hit: PRE_RELEASE_FORBIDDEN.test(bad) }).toEqual({ bad, hit: true });
    for (const ok of ["Save your spot, it's free", SPOT_RELEASE_LINE, "Thousands of Victorians have registered.", "Fitted by an EEC-certified installer"]) clean(ok, ok);
  });
});

describe("pre-release emails and texts are spot-only", () => {
  test("O1 / O2 Save my spot (none, some, questions, received) — html and text", () => {
    const variants = [
      { outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: true },
      { outcome: "likely_eligible", insulation: "present", ceilingSizeKnown: true, declaredThinPatchy: true },
      // Decision 392: the O2 "don't know" intro (new website enquirer ticked don't know).
      { outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, declaredExisting: true, declaredUnknown: true },
      { outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: true, insulationQuestions: true },
      { outcome: "needs_onsite_confirmation", insulation: "unknown", ceilingSizeKnown: false, mediaAlreadyReceived: true },
    ] as const;
    for (const v of variants) {
      const m = renderJoOutcomeEmail({ ...v, recipient: HELEN, figures: { ...FIG, areaEstimated: !v.ceilingSizeKnown, removalUpTo: 2055 }, links: LINKS } as never)!;
      expect(m).not.toBeNull();
      clean(`${JSON.stringify(v)} text`, m.plainText);
      clean(`${JSON.stringify(v)} html`, m.html.replace(/<[^>]+>/g, " "));
      clean(`${JSON.stringify(v)} subject`, m.subject);
    }
    clean("O2 don't know intro (decision 392)", O2_DONT_KNOW_INTRO);
  });
  test("the shared included / not-included cards end with the spot-only closing line", () => {
    const t = includedAndNotIncludedText({ price: 2188, rebate: 1610 });
    expect(t.at(-1)).toBe(INCLUDED_CLOSING);
    expect(t.join("\n")).not.toContain("Free Ready Check");
  });
  test("O10 Spot saved email + text", () => {
    const i = { firstName: "Helen", rebate: 1610, suburb: "Glen Waverley", shortAddress: "824 High Street Road, Glen Waverley", myJobUrl: "https://x/my-job/t", optOutUrl: "https://x/u",
      estimate: { gross: 3798, customer: 2188, areaM2: 137, address: null, calculatorUrl: `${EST}/calculator` } };
    for (const removal of [null, { kind: "included" as const, amount: 900, areaM2: 60 }, { kind: "unknown" as const }]) {
      const e = renderSpotSavedEmail({ ...i, removal });
      clean("O10 text", e.text); clean("O10 html", e.html.replace(/<[^>]+>/g, " ")); clean("O10 subject", e.subject);
    }
    const sms = renderSpotSavedSms(i);
    clean("spot saved text", sms);
    expect(sms).toContain(SPOT_RELEASE_LINE);
  });
  test("O66–O68 estimate reminders (held)", () => {
    for (const step of ESTIMATE_FOLLOWUP_STEPS) {
      const m = renderEstimateFollowupEmail({ step, firstName: "Helen", rebate: 1610, price: 2188, fullPrice: 3798, basis: "Based on what you told us: 137 m² ceiling, no existing insulation.", saveUrl: `${EST}/campaign`, calculatorUrl: `${EST}/calculator`, unsubscribeUrl: null });
      clean(`${step} text`, m.text); clean(`${step} subject`, m.subject);
    }
  });
  test("save-spot reminder text (held), estimate-unopened follow-up, not-in-area O7", () => {
    clean("blast", blastMessage("Helen", 2188, 1610, `${EST}/campaign`));
    clean("blast existing", blastMessage("Helen", 2188, 1610, `${EST}/campaign`, true));
    clean("unopened", renderFollowupEmail({ kind: "estimate_unopened_3d", estimateUrl: EST }).plainText);
    clean("O7", renderCoverageUnavailableEmail({ firstName: "Helen", suburb: "Mildura", postcode: "3500", missing: ["installer"], reference: "HV-TEST" }).plainText);
  });
  test("O76 auto-replies before release: wording and routing (a waiting owner asking for the quote gets the spot-saved answer)", () => {
    for (const a of ["save_spot", "answers_save_spot", "spot_saved", "answers_received"] as const) clean(a, answerText(a, { firstName: "Helen", link: "https://x/my-job/t" }));
    expect(LONG_LIST).toBe("Thousands of Victorians have registered. Spots are released in the order they were saved.");
    for (const a of ["save_spot", "answers_save_spot", "spot_saved", "answers_received"] as const) {
      const m = renderOwnerAutoReplyEmail({ answer: a, facts: { firstName: "Helen", link: "https://x/my-job/t" }, theirSubject: "Quote" });
      clean(`${a} html`, m.html.replace(/<[^>]+>/g, " "));
    }
    const f: OwnerJobFacts = { stage: "spot_saved", ownerFullName: "Helen Yang", spotSaved: true, questionsAnswered: false, nextVisit: null, quoteStatus: null, myJobLink: "https://x/my-job/t", questionsLink: "https://x/estimate/t/video" };
    const d = decideOwnerAutoReply({ subject: "Quote", body: "Where is my quote?", fromName: "Helen", hasAttachments: false, attachments: [], jobCount: 1, senderIsOwner: true, senderIsPartnerOrStaff: false, job: f });
    expect(d).toMatchObject({ kind: "send", answer: "spot_saved" });
  });
});

describe("pre-release page copy and shared constants", () => {
  test("constants shown before release", () => {
    const all: [string, string][] = [
      ["SPOT_SAVED_BODY", SPOT_SAVED_BODY], ["PRELIMINARY_READY_CHECK", PRELIMINARY_READY_CHECK], ["SPOT_HELD_MESSAGE", SPOT_HELD_MESSAGE],
      ["READY_CHECK_BOOKING_CLOSED", READY_CHECK_BOOKING_CLOSED], ["EXISTING_PRELIMINARY", EXISTING_PRELIMINARY], ["REMOVAL_BUDGET_EMAIL_NOTE", REMOVAL_BUDGET_EMAIL_NOTE],
      ["removalNote included", removalNote({ kind: "included", amount: 900, areaM2: 60 })], ["REMOVAL_UPTO_NOTE", REMOVAL_UPTO_NOTE],
      ["INSULATION_REVIEW_INVITATION", INSULATION_REVIEW_INVITATION], ["P1.photosSub", P1.photosSub], ["what could change", CUSTOMER_WHAT_COULD_CHANGE.intro],
      ["spot_saved owner wording", stageWording("spot_saved").owner!], ["ready_check_ready_to_schedule owner wording", stageWording("ready_check_ready_to_schedule").owner!],
      ["My job progress", SPOT_SAVED_PROGRESS.map((p) => `${p.label} ${p.sub}`).join(" ")],
      ["My job: save your spot", JSON.stringify(ownerAction({ stage: "preliminary_estimate_ready", readyCheckRequested: false, visit: null, quoteOpen: null, bookingOpen: false }))],
      ["My job: spot saved", JSON.stringify(ownerAction({ stage: "ready_check_ready_to_schedule", readyCheckRequested: false, visit: null, quoteOpen: null, bookingOpen: false }))],
    ];
    for (const [label, t] of all) clean(label, t);
  });
  test("pre-release pages no longer carry the old promises (source scan)", () => {
    const files = ["src/routes/estimate_.$token.campaign.tsx", "src/routes/estimate_.$token.video.tsx", "src/routes/estimate_.$token.calculator.tsx",
      "src/routes/save-spot-preliminary.$token.tsx", "src/components/portal/public-calculator.tsx", "src/components/portal/register-interest.tsx"];
    for (const f of files) {
      const strings = (readFileSync(f, "utf8").match(/"[^"\n]{12,}"|>[^<>{}\n]{12,}</g) ?? []).filter((s) => !/className|import |from "|\/\/|data-|onsite"|"onsite|needs_onsite/.test(s));
      for (const s of strings) clean(`${f}: ${s.slice(0, 60)}`, s.replace(/\bonsite\s*(\?|&&|\))/g, ""));
    }
    const myJob = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    for (const gone of ["The waiting list is huge", "Jump the queue", "Your exact price comes after the free Ready Check", "Pick at least 3 times that suit you for your free Ready Check", "until we text you", "book the moment it's your turn"])
      expect({ gone, present: myJob.includes(gone) }).toEqual({ gone, present: false });
    const myEstimate = readFileSync("src/routes/my-estimate.$token.tsx", "utf8");
    expect(myEstimate).not.toContain("your Ready Check will confirm the measurements");
    expect(myEstimate).toContain("{d.bookingAllowed && <tr><td>Ready Check</td>");
  });
});

describe("AI email drafts before release are spot-only", () => {
  test("pre-release prompt, rules and input carry no forbidden phrase", () => {
    clean("AI instructions", aiReplyInstructions({ preRelease: true }));
    clean("AI rules", AI_BUSINESS_RULES_PRE_RELEASE.join("\n"));
    clean("AI input", buildAiReplyInput({ jobNumber: null, ownerFirstName: null, stageLabel: "x", facts: [], links: [], changeLink: null, history: [], email: { from: null, subject: null, body: "" } }, { preRelease: true }));
  });
});

describe("approval flags: reworded live messages with a flag are held; nothing else switched", () => {
  test("decision 388 wording approved by Jo (O1/O2 25 Oct; 3-questions email by decision 393)", () => {
    expect(SAVE_SPOT_REAL_SEND_APPROVED).toBe(true); // Jo approved the spot-only O1/O2 wording 25 Oct 2026
    expect(INSULATION_DETAILS_REAL_SEND_APPROVED).toBe(true); // decision 393: Jo approved the 3-questions email for the backlog 25 Oct 2026
    expect(INSULATION_QUESTIONS_SEND_APPROVED).toBe(true); // Jo switched it back on 25 Oct 2026
    expect(ESTIMATE_FOLLOWUP_APPROVED).toBe(true); // Jo re-approved O66–O68 spot-only 25 Oct 2026
    expect(OWNER_EMAIL_AUTO_REPLY_APPROVED).toBe(true); // decision 406
    expect(SMS_MESSAGE_TYPES.spot_saved.wordingApproved).toBe(true); // Jo approved the spot-only texts 25 Oct 2026
    expect(SMS_MESSAGE_TYPES.save_spot_reminder.wordingApproved).toBe(true);
  });
  test("unchanged: the 3 questions text (wording unchanged) and the launch page gate (owners must still be able to save spots)", () => {
    expect(SMS_MESSAGE_TYPES.three_questions_reminder.wordingApproved).toBe(true);
    expect(LAUNCH_COPY_APPROVED).toBe(true);
  });
  test("the O1/O2 flag really holds the real senders", () => {
    expect(readFileSync("src/lib/hot-leads-send.server.ts", "utf8")).toContain("if (!SAVE_SPOT_REAL_SEND_APPROVED) return false;");
    expect(readFileSync("src/lib/followups.server.ts", "utf8")).toContain('if (!SAVE_SPOT_REAL_SEND_APPROVED) return { sent: false as const, reason: "wording_not_approved" };');
  });
});
