// Decision 172: pure selection and wording rules for the one-off "3 questions" reminder.
import { describe, expect, test } from "bun:test";
import {
  SKIP, THREE_QUESTIONS_CUTOFF_ISO, selectThreeQuestionsReminder, threeQuestionsClaimId, threeQuestionsEmailKey, threeQuestionsSms, threeQuestionsSmsKey,
  type ReminderRow,
} from "../src/lib/three-questions-reminder.core";
import { SMS_MESSAGE_TYPES, brandSmsBody, smsBlocker } from "../src/lib/sms.core";

const LINK = "https://estimate.homeinsulationvictoria.com.au/estimate/tok/video";
const row = (patch: Partial<ReminderRow> = {}): ReminderRow => ({
  id: "a", job_number: "HV-1", created_at: "2026-10-20T04:00:00Z", source: "base44", stage: "preliminary_estimate_ready", eligibility_outcome: "likely_eligible",
  removed: false, deleted_at: null, owner_name: "Helen Smith", owner_email: "helen@example.com", owner_phone: "0491234567", spot_saved: false, contact_rank: 1,
  declared: "unknown", tapAnswered: false, emailOptedOut: false, rebate: 1610, link: LINK, renderProblem: null, ...patch,
});
const plan = (rows: ReminderRow[], opts: string[] = [], jobs: string[] = [], phones: string[] = []) => selectThreeQuestionsReminder(rows, opts, jobs, phones);
const only = (patch: Partial<ReminderRow>) => plan([row(patch)]).skipped[0]?.reason;

describe("who gets the reminder", () => {
  test("an unanswered pre-23-Oct enquiry with a working link is reminded once by email and text", () => {
    const r = plan([row()]).recipients;
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ jobId: "a", firstName: "Helen", email: "helen@example.com", phone: "0491234567", rebate: 1610, link: LINK, emailKey: threeQuestionsEmailKey("a"), smsKey: threeQuestionsSmsKey("a") });
  });
  test("the cutoff is 23 Oct 2026 00:00 Melbourne (22 Oct 13:00 UTC): from then the website asks the questions", () => {
    expect(THREE_QUESTIONS_CUTOFF_ISO).toBe("2026-10-22T13:00:00.000Z");
    expect(only({ created_at: "2026-10-22T12:59:59Z" })).toBeUndefined();
    expect(only({ created_at: "2026-10-22T13:00:00Z" })).toBe(SKIP.after_cutoff);
    expect(only({ created_at: "2026-10-24T01:00:00Z" })).toBe(SKIP.after_cutoff);
  });
  test("TEST, closed, ineligible, unresolved, opted-out and already-answered enquiries are skipped with a reason", () => {
    expect(only({ source: "qa_test" })).toBe(SKIP.test);
    expect(only({ owner_name: "Testy McTest" })).toBe(SKIP.test);
    expect(only({ deleted_at: "2026-10-21T00:00:00Z" })).toBe(SKIP.closed);
    expect(only({ removed: true })).toBe(SKIP.closed);
    expect(only({ stage: "cancelled" })).toBe(SKIP.closed);
    expect(only({ eligibility_outcome: "does_not_appear_eligible" })).toBe(SKIP.ineligible);
    expect(only({ eligibility_outcome: null })).toBe(SKIP.no_result);
    expect(only({ emailOptedOut: true })).toBe(SKIP.opted_out);
    expect(plan([row()], ["+61491234567"]).skipped[0]?.reason).toBe(SKIP.opted_out);
    expect(only({ tapAnswered: true })).toBe(SKIP.answered);
  });
  test("the questions email only applies to unconfirmed insulation: 'no insulation' owners and saved spots are skipped", () => {
    expect(only({ declared: "none" })).toBe(SKIP.said_none);
    expect(only({ spot_saved: true })).toBe(SKIP.saved);
    expect(only({ declared: "present" })).toBeUndefined();
  });
  test("one reminder per home: recorded email sends, SMS claims (by job or phone) and duplicate contacts never repeat", () => {
    expect(plan([row()], [], ["a"]).skipped[0]?.reason).toBe(SKIP.sent);
    expect(plan([row({ id: "b" })], [], [], ["+61491234567"]).skipped[0]?.reason).toBe(SKIP.sent);
    expect(only({ contact_rank: 2 })).toBe(SKIP.duplicate);
    const two = plan([row({ id: "older", created_at: "2026-10-01T00:00:00Z" }), row({ id: "newer", owner_phone: "+61491234567" })]);
    expect(two.recipients.map((r) => r.jobId)).toEqual(["older"]);
    expect(two.skipped[0]?.reason).toBe(SKIP.duplicate);
  });
  test("missing facts fail closed: no contact, no link, no figures, email not prepared", () => {
    expect(only({ owner_email: null, owner_phone: null })).toBe(SKIP.no_contact);
    expect(only({ owner_phone: "+12025550123", owner_email: null })).toBe(SKIP.no_contact);
    expect(only({ link: null })).toBe(SKIP.no_link);
    expect(only({ rebate: null })).toBe(SKIP.no_figures);
    expect(only({ renderProblem: "Estimate size basis needs office review" })).toBe("Estimate size basis needs office review");
  });
  test("email-only and text-only homes are still reminded on the channel they have", () => {
    expect(plan([row({ owner_phone: null })]).recipients[0]).toMatchObject({ email: "helen@example.com", phone: null });
    expect(plan([row({ owner_email: null })]).recipients[0]).toMatchObject({ email: null, phone: "0491234567" });
  });
  test("a TEST job is only allowed when the office explicitly asks for a TEST copy", () => {
    expect(selectThreeQuestionsReminder([row({ source: "qa_test", created_at: "2026-10-24T00:00:00Z" })], [], [], [], { allowTest: true, ignoreCutoff: true }).recipients).toHaveLength(1);
  });
});

describe("approved wording and keys", () => {
  test("text is Jo's approved wording (decision 172) with the brand prefix added at send time", () => {
    const body = threeQuestionsSms("Helen", 1610, LINK);
    expect(body).toBe(`Hi Helen, 3 quick questions and your $1,610 rebate spot is saved: ${LINK} Reply STOP to opt out.`);
    expect(brandSmsBody(body)).toBe(`Home Insulation Victoria: ${body}`);
    expect(plan([row()]).recipients[0]?.smsBody).toBe(body);
  });
  test("the SMS type exists, is owner-facing, approved and respects quiet hours; the retired booking text is gone", () => {
    expect(SMS_MESSAGE_TYPES.three_questions_reminder).toEqual({ audience: "owner", label: "One-off 3 questions reminder", wordingApproved: true, quietHours: true });
    expect("ready_check_booking" in SMS_MESSAGE_TYPES).toBe(false);
  });
  test("the office blast authorization stands in for the per-type switch only; master switch, opt-outs, consent and TEST still block", () => {
    const gate = { type: "three_questions_reminder", to: "0491234567", commsEnabled: true, typeSwitchOn: false, senderConfigured: true, optedOut: false, consent: true, isTestRecord: false, adminSpotReminderBlast: true, nowIso: "2026-10-24T02:00:00Z" };
    expect(smsBlocker(gate)).toBeNull();
    expect(smsBlocker({ ...gate, adminSpotReminderBlast: false })).toContain("switched off");
    expect(smsBlocker({ ...gate, type: "spot_saved" })).toContain("switched off");
    expect(smsBlocker({ ...gate, commsEnabled: false })).toContain("switched off");
    expect(smsBlocker({ ...gate, optedOut: true })).toContain("STOP");
    expect(smsBlocker({ ...gate, consent: false })).toContain("consent");
    expect(smsBlocker({ ...gate, isTestRecord: true })).toContain("TEST");
  });
  test("phone claims are stable per number and separate from the Save My Spot reminder's claims", async () => {
    const { blastClaimId } = await import("../src/lib/save-spot-reminder-blast.core");
    expect(await threeQuestionsClaimId("0491234567")).toBe(await threeQuestionsClaimId("+61491234567"));
    expect(await threeQuestionsClaimId("0491234567")).not.toBe(await blastClaimId("0491234567"));
  });
});
