import { describe, expect, test } from "bun:test";
import { declineAutoClose, isClearDecline, type DeclineCloseFacts } from "../src/lib/email-intent.core";
import { buildEmailsTab, readsAsDecline } from "../src/lib/emails-tab.core";

// Jo 27 Oct 2026: a clear "not going ahead" email closes an unbooked, unpaid enquiry by itself.
const mail = (body: string) => ({ subject: "Re: Your estimate", body, direction: "inbound" as const, from: "owner@example.test" });
const unbooked: DeclineCloseFacts = { stage: "preliminary_estimate_ready", deleted: false, senderIsOwner: true, fromPartner: false, matchedJobs: 1, confirmedBooking: false, paid: false };

describe("clear declines close an unbooked job", () => {
  for (const body of [
    "Thanks but we are not going ahead.",
    "Not interested, thanks.",
    "No thanks.",
    "Please cancel my enquiry.",
    "I will leave for now, and hope to proceed next year.",
    "We can't afford it at the moment.",
    "The grant is great however not enough for us to go ahead. We do not have the balance needed.",
    "We've gone with someone else.",
  ]) test(body, () => {
    expect(isClearDecline(mail(body)).decline).toBe(true);
    expect(declineAutoClose(unbooked)).toEqual({ close: true });
  });
});

describe("questions, price checks and hedges never close", () => {
  for (const body of ["too expensive, can you check?", "Who would contact me for installation?", "I'll be overseas till the end of the month.", "Is this price right?"])
    test(body, () => expect(isClearDecline(mail(body)).decline).toBe(false));
});

describe("booked or paid jobs keep the Needs me card", () => {
  test("confirmed booking", () => expect(declineAutoClose({ ...unbooked, stage: "ready_check_ready_to_schedule", confirmedBooking: true }).close).toBe(false));
  test("paid", () => expect(declineAutoClose({ ...unbooked, paid: true }).close).toBe(false));
  test("past enquiry stage", () => expect(declineAutoClose({ ...unbooked, stage: "ready_check_scheduled" }).close).toBe(false));
  test("not the owner", () => expect(declineAutoClose({ ...unbooked, senderIsOwner: false }).close).toBe(false));
  test("ready_check_ready_to_schedule without booking still closes", () => expect(declineAutoClose({ ...unbooked, stage: "ready_check_ready_to_schedule" }).close).toBe(true));
});

describe("Done on a decline card never leaves the job open silently", () => {
  const base = { jobDrafts: new Map(), noJobDrafts: new Map(), closedJobDrafts: new Set<string>(), ownerNameByJob: new Map(), autoRepliedSenders: new Set<string>(), unmatched: [] };
  const row = (intent: string) => ({ eventId: "e1", jobId: "j1", jobNumber: "HV-1", at: "2026-10-27T00:00:00Z", intent, messageId: "m1", from: null, subject: null, label: null });
  test("reply card whose email declines, job open → Still open", () => {
    const t = buildEmailsTab({ ...base, changes: [row("reply")], inboundByMessage: new Map([["m1", "I will leave for now, and hope to proceed next year."]]), openJobIds: new Set(["j1"]) });
    expect(t.withJob[0]!.stillOpenDecline).toBe(true);
  });
  test("same card once the job is closed → normal Done", () => {
    const t = buildEmailsTab({ ...base, changes: [row("reply")], inboundByMessage: new Map([["m1", "I will leave for now."]]), openJobIds: new Set() });
    expect(t.withJob[0]!.stillOpenDecline).toBe(false);
  });
  test("a question card stays a normal Done", () => expect(readsAsDecline("Who would contact me for installation?")).toBe(false));
});
