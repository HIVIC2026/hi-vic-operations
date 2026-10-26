// Decision 337 (Jo 25 Oct 2026): a matched owner's "change the day / cancel" email gets ONE automatic reply with their
// own secure My job link on the right screen; the decision-245 office row stays only for cancels the owner can't do.
// Pure rules (intent → visit, link, cancel note, idempotency, mode, office row), the trade texts, and source pins.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CANCEL_NOTE_REPLY, CHANGE_VISIT, EMAIL_CHANGE_REPLY_APPROVED, cancelNote, changeReplyFirstName, changeReplyKey, changeReplyMode, changeReplySubject,
  changeReplyText, changeVisitLink, officeRowNeeded, planChangeReply, renderChangeReplyEmail, visitForStage, visitGroupForStage, type ChangeReplyInput,
} from "../src/lib/email-change-reply.core";
import { ownerCanCancel } from "../src/lib/owner-myjob.core";
import { ownerChangedVisitKey, ownerChangedVisitText } from "../src/lib/installer-texts.core";
import { SMS_FRESHNESS, SMS_MESSAGE_TYPES } from "../src/lib/sms.core";

const ALL = { readyCheck: true, piesa: true, install: true };
const NONE = { readyCheck: false, piesa: false, install: false };
const LINK = "https://estimate.homeinsulationvictoria.com.au/my-job/tok123";
const input = (o: Partial<ChangeReplyInput> = {}): ChangeReplyInput => ({
  intent: "reschedule", jobIds: ["job-1"], senderIsOwner: true, fromPartner: false, testJob: false, stage: "installation_booked",
  avail: ALL, ownerCanSelfCancel: false, hasLink: true, prior: "none", ...o,
});
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("intent → visit mapping", () => {
  test("Ready Check stages → Ready Check visit (home screen, your installer)", () => {
    for (const s of ["ready_check_awaiting_acceptance", "ready_check_ready_to_schedule", "ready_check_scheduled"]) expect(visitForStage(s, ALL)).toBe("ready_check");
    expect(CHANGE_VISIT.ready_check).toEqual({ visit: "Ready Check visit", who: "your installer", screen: "home" });
  });
  test("PIESA stages → electrical safety check (book screen, your electrician)", () => {
    for (const s of ["measured_quote_accepted", "piesa_and_install_window_pending", "piesa_scheduled"]) expect(visitForStage(s, ALL)).toBe("piesa");
    expect(CHANGE_VISIT.piesa).toEqual({ visit: "electrical safety check", who: "your electrician", screen: "book" });
  });
  test("install stages → install day (book screen, your installer)", () => {
    for (const s of ["piesa_complete", "installation_scheduling", "installation_booked"]) expect(visitForStage(s, ALL)).toBe("install");
    expect(CHANGE_VISIT.install).toEqual({ visit: "install day", who: "your installer", screen: "book" });
  });
  test("no visit when My job can't change it right now, or the stage has none (fixes visits stay with the office)", () => {
    expect(visitForStage("installation_booked", { ...ALL, install: false })).toBeNull();
    expect(visitForStage("piesa_scheduled", { ...ALL, piesa: false })).toBeNull();
    expect(visitForStage("ready_check_scheduled", NONE)).toBeNull();
    for (const s of ["new_enquiry", "preliminary_estimate_ready", "ready_check_complete", "rectification_booked", "rectification_scheduling", "evidence_outstanding", "complete", "cancelled", null]) expect(visitForStage(s, ALL)).toBeNull();
    expect(visitGroupForStage("piesa_scheduled")).toBe("piesa");
  });
});

describe("link building", () => {
  test("the owner's own link, on the visit's screen", () => {
    expect(changeVisitLink(LINK, "ready_check")).toBe(LINK);
    expect(changeVisitLink(LINK, "piesa")).toBe(`${LINK}?screen=book`);
    expect(changeVisitLink(LINK, "install")).toBe(`${LINK}?screen=book`);
    expect(changeVisitLink(`${LINK}?screen=quote`, "install")).toBe(`${LINK}?screen=book`);
    expect(changeVisitLink(`${LINK}/`, "piesa")).toBe(`${LINK}?screen=book`);
  });
  test("every screen used is one My job accepts", () => {
    const route = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    const screens = route.match(/const SCREENS = \[([^\]]+)\]/)![1]!;
    for (const v of Object.values(CHANGE_VISIT)) expect(screens).toContain(`"${v.screen}"`);
  });
});

describe("cancel note", () => {
  test("empty when the owner can cancel on My job, else the reply-to-us note", () => {
    expect(cancelNote(true)).toBe("");
    expect(cancelNote(false)).toBe(", or reply to this email and we'll sort it out with you");
    expect(CANCEL_NOTE_REPLY).toBe(cancelNote(false));
  });
  test("follows My job's own cancel rule (NO_OWNER_CANCEL): before the safety check is booked yes, after no", () => {
    expect(cancelNote(ownerCanCancel("ready_check_scheduled", ["ready_check"]))).toBe("");
    expect(cancelNote(ownerCanCancel("piesa_and_install_window_pending", []))).toBe("");
    expect(cancelNote(ownerCanCancel("piesa_scheduled", ["assessment"]))).toBe(CANCEL_NOTE_REPLY);
    expect(cancelNote(ownerCanCancel("installation_booked", ["installation"]))).toBe(CANCEL_NOTE_REPLY);
  });
});

describe("wording (approved route)", () => {
  test("subject Re: their subject; body verbatim", () => {
    expect(changeReplySubject("Install day")).toBe("Re: Install day");
    expect(changeReplySubject("RE: Install day")).toBe("RE: Install day");
    expect(changeReplySubject(null)).toBe("Re: Your email");
    expect(changeReplyText({ firstName: "Jane", visit: "install", link: `${LINK}?screen=book`, cancelNote: CANCEL_NOTE_REPLY })).toBe(
      `Hi Jane, no problem. You can change your install day here and your installer will be told straight away: ${LINK}?screen=book. If you'd rather cancel, you can do that on the same page, or reply to this email and we'll sort it out with you. — Home Insulation Victoria`);
    expect(changeReplyText({ firstName: null, visit: "piesa", link: LINK, cancelNote: "" })).toBe(
      `Hi there, no problem. You can change your electrical safety check here and your electrician will be told straight away: ${LINK}. If you'd rather cancel, you can do that on the same page. — Home Insulation Victoria`);
    expect(changeReplyText({ firstName: "Sam", visit: "ready_check", link: LINK, cancelNote: "" })).toContain("change your Ready Check visit here and your installer will be told");
  });
  test("first name: owner on file first, then the From name; never an address", () => {
    expect(changeReplyFirstName("jane smith", "Someone Else")).toBe("Jane");
    expect(changeReplyFirstName(null, "Smith, Bob")).toBe("Bob");
    expect(changeReplyFirstName(null, "bob@example.com")).toBeNull();
  });
  test("the email carries the link and the same words, plus the TEST label only for test-send", () => {
    const f = { firstName: "Jane", visit: "install" as const, link: `${LINK}?screen=book`, cancelNote: "", theirSubject: "Change of plans" };
    const live = renderChangeReplyEmail({ ...f, unsubscribe: "https://u.example/x" });
    expect(live.subject).toBe("Re: Change of plans");
    expect(live.html).toContain(`href="${LINK}?screen=book"`);
    expect(live.html).not.toContain("TEST — only sent to Jo");
    expect(live.text).toContain(changeReplyText(f));
    expect(renderChangeReplyEmail({ ...f, test: true }).html).toContain("TEST — only sent to Jo");
  });
});

describe("plan, idempotency and mode", () => {
  test("a reschedule from the owner → reply, no office row", () => {
    const p = planChangeReply(input());
    expect(p).toEqual({ kind: "reply", visit: "install", cancelNote: CANCEL_NOTE_REPLY, keepOfficeRow: false });
    expect(officeRowNeeded("reschedule", { sent: true, keepOfficeRow: false })).toBe(false);
  });
  test("a cancel past acceptance → reply with the note AND one office row; before → reply, no row", () => {
    expect(planChangeReply(input({ intent: "cancel" }))).toEqual({ kind: "reply", visit: "install", cancelNote: CANCEL_NOTE_REPLY, keepOfficeRow: true });
    expect(officeRowNeeded("cancel", { sent: true, keepOfficeRow: true })).toBe(true);
    expect(planChangeReply(input({ intent: "cancel", stage: "ready_check_scheduled", ownerCanSelfCancel: true }))).toEqual({ kind: "reply", visit: "ready_check", cancelNote: "", keepOfficeRow: false });
    expect(officeRowNeeded("cancel", { sent: true, keepOfficeRow: false })).toBe(false);
  });
  test("anything uncertain keeps the decision-245 office row", () => {
    expect(planChangeReply(input({ intent: "contact_change" })).kind).toBe("office");
    expect(planChangeReply(input({ jobIds: ["a", "b"] })).kind).toBe("office");
    expect(planChangeReply(input({ jobIds: [] })).kind).toBe("office");
    expect(planChangeReply(input({ senderIsOwner: false })).kind).toBe("office");
    expect(planChangeReply(input({ fromPartner: true })).kind).toBe("office");
    expect(planChangeReply(input({ avail: NONE })).kind).toBe("office");
    expect(planChangeReply(input({ stage: "rectification_booked" })).kind).toBe("office");
    expect(planChangeReply(input({ hasLink: false })).kind).toBe("office");
    expect(planChangeReply(input({ prior: "held" })).kind).toBe("office");
    for (const i of ["contact_change", "attachment"]) expect(officeRowNeeded(i, { sent: true, keepOfficeRow: false })).toBe(true);
    expect(officeRowNeeded("reschedule", null)).toBe(true);
    expect(officeRowNeeded("reschedule", { sent: false, keepOfficeRow: false })).toBe(true);
  });
  test("one reply per job + email message", () => {
    expect(changeReplyKey("job-1", "AAMk-1")).toBe("email-change-reply:v1:job-1:AAMk-1");
    expect(changeReplyKey("job-1", "AAMk-1")).not.toBe(changeReplyKey("job-1", "AAMk-2"));
    expect(planChangeReply(input({ prior: "sent" }))).toEqual({ kind: "already", keepOfficeRow: false });
    expect(planChangeReply(input({ prior: "sent", intent: "cancel" }))).toEqual({ kind: "already", keepOfficeRow: true });
  });
  test("TEST jobs → test-send; real owners need the approved flag and customer comms on", () => {
    expect(EMAIL_CHANGE_REPLY_APPROVED).toBe(true);
    expect(changeReplyMode({ testJob: true, approved: false, commsEnabled: null })).toEqual({ mode: "test_send" });
    expect(changeReplyMode({ testJob: false, approved: true, commsEnabled: true })).toEqual({ mode: "live" });
    expect(changeReplyMode({ testJob: false, approved: false, commsEnabled: true }).mode).toBe("held");
    expect(changeReplyMode({ testJob: false, approved: true, commsEnabled: false }).mode).toBe("held");
    expect(changeReplyMode({ testJob: false, approved: true, commsEnabled: null }).mode).toBe("held");
  });
});

describe("the trade is told when the owner changes on My job", () => {
  test("wording per visit, one text per change", () => {
    const was = "2026-11-03T23:00:00Z"; // Wed 4 Nov 10am Melbourne
    expect(ownerChangedVisitText({ kind: "ready_check", suburb: "Frankston", jobNumber: "HV-1001", wasIso: was, link: "https://x/field/j" }))
      .toBe("The owner at Frankston (HV-1001) changed their Ready Check time, so the booking on Wednesday 4 November 10am is cancelled. Please offer them 3 new times: https://x/field/j");
    expect(ownerChangedVisitText({ kind: "installation", suburb: null, jobNumber: "HV-1001", wasIso: null, link: "https://x/field/j" }))
      .toBe("The owner at the property (HV-1001) changed their install day, so the booking is cancelled. Please offer them 3 new days: https://x/field/j");
    expect(ownerChangedVisitText({ kind: "assessment", suburb: "Frankston", jobNumber: "HV-1001", wasIso: was, link: null }))
      .toBe("The owner at Frankston (HV-1001) changed their electrical safety check time, so the booking on Wednesday 4 November 10am is cancelled. You don't need to go.");
    expect(ownerChangedVisitKey("j", "ev1")).toBe("owner-changed-visit:v1:j:ev1");
    expect(SMS_MESSAGE_TYPES.owner_changed_visit.audience).toBe("partner");
    expect(SMS_FRESHNESS.owner_changed_visit).toEqual({ kind: "event", maxAgeMinutes: 24 * 60 });
  });
  test("each owner change path tells the trade (source pins)", () => {
    const rc = strip(readFileSync("src/lib/ready-check-times.server.ts", "utf8"));
    const rcOwner = rc.slice(rc.indexOf("export async function ownerChangeReadyCheck"), rc.indexOf("export async function installerChangeReadyCheck"));
    expect(rcOwner).toContain(`textTradeOwnerChangedVisit({ jobId, kind: "ready_check"`);
    const inst = strip(readFileSync("src/lib/install-days.server.ts", "utf8"));
    const change = inst.slice(inst.indexOf("export async function changeInstallDay"), inst.indexOf("export async function sweepInstallDays"));
    expect(change).toMatch(/if \(who === "owner"\) \{[\s\S]*textTradeOwnerChangedVisit\(\{ jobId, kind: "installation"/);
    const ve = strip(readFileSync("src/lib/visit-events.server.ts", "utf8"));
    const piesa = ve.slice(ve.indexOf("export async function ownerChangeBookedPiesa"), ve.indexOf("async function requireBookingTrade"));
    // The electrician business is read BEFORE ownerChangeVisit releases the assignment.
    expect(piesa.indexOf("electricianBusinessId = ")).toBeLessThan(piesa.indexOf("await ownerChangeVisit("));
    expect(piesa).toContain(`kind: "assessment"`);
    // Owner suggestions already text the installer (decision 79); owner PIESA times start offers to electricians.
    expect(rc).toContain("await tellInstallerDaysSuggested(jobId");
    expect(strip(readFileSync("src/lib/allocation.server.ts", "utf8"))).toMatch(/submitOwnerPiesaWindows[\s\S]*startPiesaAllocation\(jobId, null\)/);
  });
  test("My job: booked safety check has a Change time button, and Cancel is on the Book screen too", () => {
    const route = readFileSync("src/routes/my-job.$token.tsx", "utf8");
    expect(route).toContain("ownerChangePiesaFn");
    expect(route).toContain(`data-testid="piesa-booked"`);
    const book = route.slice(route.indexOf("function BookScreen"), route.indexOf("function DoneScreen"));
    expect(book).toContain("{v.canCancel && <CancelMyJob token={token} />}");
    const fns = readFileSync("src/lib/owner-link.functions.ts", "utf8");
    expect(fns).toMatch(/export const ownerChangePiesaFn = createServerFn\(\{ method: "POST" \}\)\.middleware\(\[withRequestMeta\]\)\s*\.inputValidator/);
    expect(fns).toContain("ownerSession(data.token, data.session)");
  });
});

describe("source pins", () => {
  test("the reply goes only through the guarded owner email path or test-send — never Outlook / Graph", () => {
    const s = strip(readFileSync("src/lib/email-change-reply.server.ts", "utf8"));
    expect(s).not.toMatch(/sendMail|createReply|\/reply\b|\/forward\b|microsoft_outlook|outlookGatewayUrl|outlook-connection|graph\.microsoft|fetch\(|resendSend/i);
    expect(s).toContain("sendGuardedOwnerEmail(");
    expect(s).toContain("assertCustomerDeliveryAllowed(");
    expect(s).toContain("sendTestEmail(");
    // The claim is written before either send.
    expect(s.indexOf("EMAIL_CHANGE_REPLIED_EVENT, `Owner emailed")).toBeLessThan(s.indexOf("sendTestEmail("));
    expect(s.indexOf("EMAIL_CHANGE_REPLIED_EVENT, `Owner emailed")).toBeLessThan(s.indexOf("sendGuardedOwnerEmail("));
    // Nothing on this path books, moves, cancels or changes a stage.
    expect(s).not.toMatch(/confirmBooking|transition\(|cancelJobFully|ownerChangeVisit|changeInstallDay|\.update\(/);
  });
  test("the copier calls the reply for reschedule/cancel and raises the row only when still needed", () => {
    const s = strip(readFileSync("src/lib/outlook-sync.server.ts", "utf8"));
    const rec = s.slice(s.indexOf("export async function recordChangeRequests"), s.indexOf("async function draftReply"));
    expect(rec).toContain(`replyToChangeRequest({ jobIds, message: m, intent: c.intent, fromPartner: partner })`);
    expect(rec).toContain("if (!officeRowNeeded(c.intent, replied.get(c.intent) ?? null)) continue;");
    expect(rec.indexOf("replyToChangeRequest(")).toBeLessThan(rec.indexOf("EMAIL_CHANGE_REQUEST_EVENT, internal: true"));
  });
});
