// Jo 28 Oct 2026 spec, parts 1–3: people without an email, Lead / Crew and the crew reminder email. Pure rules here;
// persistence in worker-role-crew-server.test.ts and the schema change in worker-email-optional-db.test.ts.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { certOrFilter, effectiveWorkerRole, mittiEmailFor, roleSwitchMittiAction, sameWorkerEmail, canChangeWorkerRole } from "../src/lib/worker-role.core";
import { CREW_SKIP, mittiInviteStep, type InvitePerson } from "../src/lib/mitti-invite.core";
import { CREW_REMINDER_EMAIL_APPROVED, crewReminderBlocker, crewReminderDue, crewReminderEmail, crewReminderKey } from "../src/lib/crew-reminder.core";
import { collectionNoticeStatus, ackFromEventDetails, COLLECTION_NOTICE_SHA256 } from "../src/lib/esc-collection-notice.core";

describe("1. people without an email", () => {
  test("certification matching uses the email only when there is one", () => {
    expect(certOrFilter([{ id: "a", email: null }, { id: "b", email: " " }])).toBe("worker_id.in.(a,b)");
    expect(certOrFilter([{ id: "a", email: "X@y.com" }, { id: "b", email: null }])).toBe('worker_id.in.(a,b),worker_email.in.("x@y.com")');
    expect(sameWorkerEmail(null, "")).toBe(false);
    expect(sameWorkerEmail("", "")).toBe(false);
    expect(sameWorkerEmail("A@b.com ", "a@B.com")).toBe(true);
  });
  test("a person with no email can still acknowledge the privacy notice (matched by their id)", () => {
    const ack = ackFromEventDetails({ worker_id: "w1", worker_email: "", at: "2026-10-28T00:00:00Z", by_name: "Sam", notice_sha256: COLLECTION_NOTICE_SHA256 })!;
    expect(ack).not.toBeNull();
    const s = collectionNoticeStatus([{ id: "w1", email: null, full_legal_name: "Sam", trade_role: "installer" }, { id: "w2", email: null, full_legal_name: "Pat", trade_role: "installer" }], [ack]);
    expect(s.map((x) => x.state)).toEqual(["acknowledged", "missing"]);
  });
});

describe("2. Lead / Crew", () => {
  test("null counts as Lead (Jo 29 Oct answer 1); Crew only when stored", () => {
    expect(effectiveWorkerRole({ tradeRole: "installer", stored: null })).toBe("lead");
    expect(effectiveWorkerRole({ tradeRole: "installer", stored: undefined })).toBe("lead");
    expect(effectiveWorkerRole({ tradeRole: "installer", stored: "crew" })).toBe("crew");
    expect(effectiveWorkerRole({ tradeRole: "installer", stored: "lead" })).toBe("lead");
    expect(effectiveWorkerRole({ tradeRole: "electrician", stored: null })).toBeNull();
  });
  test("only HIV admins and the business's own business_admin may switch", () => {
    expect(canChangeWorkerRole({ isAdmin: true, memberRole: null })).toBe(true);
    expect(canChangeWorkerRole({ isAdmin: false, memberRole: "business_admin" })).toBe(true);
    expect(canChangeWorkerRole({ isAdmin: false, memberRole: "staff" })).toBe(false);
  });
  const person = (p: Partial<InvitePerson> = {}): InvitePerson => ({ workerId: "w1", tradeRole: "installer", approvalStatus: "approved", removedAt: null, email: "lead@biz.com.au", ciiCleared: true, mittiAccess: null, isTest: false, ...p });
  const ON = { enabled: true, apiVerified: true, groupId: "g" };
  test("(a) the Mitti invite only invites Leads", () => {
    expect(mittiInviteStep(person({ crew: true }), null, ON)).toEqual({ action: "skip", reason: CREW_SKIP });
    expect(mittiInviteStep(person({ crew: false }), null, ON).action).toBe("lookup");
    // Electricians are not Lead/Crew and keep their existing rule.
    expect(mittiInviteStep(person({ tradeRole: "electrician", crew: true }), null, ON).action).toBe("lookup");
  });
  test("(b) a Lead with no email of their own uses the business's own email; Crew gets none", () => {
    expect(mittiEmailFor({ role: "lead", ownEmail: null, businessEmail: "Office@Biz.com.au" })).toEqual({ email: "office@biz.com.au", source: "business" });
    expect(mittiEmailFor({ role: "lead", ownEmail: "me@biz.com.au", businessEmail: "office@biz.com.au" })).toEqual({ email: "me@biz.com.au", source: "own" });
    expect(mittiEmailFor({ role: "crew", ownEmail: null, businessEmail: "office@biz.com.au" })).toEqual({ email: null, source: null });
  });
  test("switching: to Lead invites; to Crew leaves Mitti alone (Jo answer 8)", () => {
    expect(roleSwitchMittiAction("crew", "lead")).toBe("invite");
    expect(roleSwitchMittiAction("lead", "crew")).toBe("none");
    expect(roleSwitchMittiAction("lead", "lead")).toBe("none");
    expect(readFileSync("src/lib/worker-links.functions.ts", "utf8")).not.toContain("onPartnerPersonDemoted");
    expect(readFileSync("src/lib/mitti-invite.core.ts", "utf8")).not.toContain("demoted");
  });
  test("crew never auto-invited (Jo answer 9)", () => {
    expect(CREW_SKIP).toBe("Crew aren't invited automatically — the office adds them to Mitti by hand.");
  });
});

describe("3. crew reminder email", () => {
  // Install 29 Oct 2026 08:00 Melbourne (AEDT, UTC+11) = 28 Oct 21:00Z.
  const start = "2026-10-28T21:00:00Z";
  test("due from 2pm Melbourne the day before, not before, not on install day", () => {
    expect(crewReminderDue(new Date("2026-10-28T02:59:00Z"), start)).toBe(false); // 1:59pm 28 Oct
    expect(crewReminderDue(new Date("2026-10-28T03:00:00Z"), start)).toBe(true); // 2:00pm 28 Oct
    expect(crewReminderDue(new Date("2026-10-28T12:59:00Z"), start)).toBe(true); // 11:59pm 28 Oct
    expect(crewReminderDue(new Date("2026-10-28T13:00:00Z"), start)).toBe(false); // midnight → install day
  });
  const f = { bookingKind: "installation", bookingStatus: "confirmed", scheduledStart: start, crewSelected: false, alreadySent: false, jobDeleted: false, businessEmail: "boss@biz.com.au" };
  const at2pm = new Date("2026-10-28T03:05:00Z");
  test("only install bookings, not cancelled, with no crew picked, once per job + date, to a business email", () => {
    expect(crewReminderBlocker(f, at2pm)).toBeNull();
    expect(crewReminderBlocker({ ...f, bookingKind: "ready_check" }, at2pm)).toBe("not an install booking");
    expect(crewReminderBlocker({ ...f, bookingStatus: "cancelled" }, at2pm)).toBe("booking cancelled");
    expect(crewReminderBlocker({ ...f, crewSelected: true }, at2pm)).toBe("crew already picked");
    expect(crewReminderBlocker({ ...f, alreadySent: true }, at2pm)).toBe("already sent for this install date");
    expect(crewReminderBlocker({ ...f, businessEmail: null }, at2pm)).toBe("no business email on file");
    expect(crewReminderKey("j1", "2026-10-29")).toBe("crew-reminder:v1:j1:2026-10-29");
  });
  test("draft wording exactly as approved for drafting; real sends off", () => {
    expect(CREW_REMINDER_EMAIL_APPROVED).toBe(false);
    expect(crewReminderEmail({ shortAddress: "12 Wattle St, Brighton", address: "12 Wattle St, Brighton 3186", jobLink: "https://x/field/j1" })).toEqual({
      subject: "Pick the crew for tomorrow's install – 12 Wattle St, Brighton",
      body: "Tomorrow's install at 12 Wattle St, Brighton 3186 has no Lead installer or crew picked yet. Please pick them on the job page so everyone gets their safety plan and the Mitti form is ready: https://x/field/j1",
    });
  });
});
