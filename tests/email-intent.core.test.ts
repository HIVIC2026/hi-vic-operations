import { describe, expect, test } from "bun:test";
import { changeRequestLabel, classifyEmailIntents, normalisePhone, openChangeRequests, proposedChanges, recentEnoughForAction, type IntentInput } from "../src/lib/email-intent.core";

// Decision 245: realistic, anonymised owner/partner emails (names, numbers and addresses invented).
const mail = (body: string, extra: Partial<IntentInput> = {}): IntentInput => ({ subject: "Re: Your free insulation Ready Check HV-3150", body, direction: "inbound", from: "owner@example.test", ...extra });
const intents = (body: string, extra: Partial<IntentInput> = {}) => classifyEmailIntents(mail(body, extra)).map((h) => h.intent);

describe("cancel", () => {
  test("explicit not proceeding is a cancel", () => {
    expect(intents("Hi team,\n\nThanks for your help but we have decided not to go ahead with the insulation.\n\nRegards,\nSam Example")).toEqual(["cancel"]);
    expect(intents("Please cancel my booking, we've gone with another company.")).toContain("cancel");
    const [c] = proposedChanges(mail("We've gone with another installer, sorry. Please cancel."));
    expect(c).toMatchObject({ intent: "cancel" });
    expect((c as { reason: string }).reason).toContain("other provider");
  });
  test("hedged or questioning mail is never a cancel", () => {
    expect(intents("We might not go ahead if the price is too high — can you tell me the final cost?")).not.toContain("cancel");
    expect(intents("Not sure we'll proceed yet, still thinking about it.")).not.toContain("cancel");
  });
  test("our quoted history never counts", () => {
    const body = "Sounds good, see you then.\n\nOn Tue, 20 Oct 2026 at 9:00 am Home Insulation Victoria wrote:\n> If you no longer want to proceed, please cancel by replying.";
    expect(intents(body)).not.toContain("cancel");
  });
  test("a partner can't cancel an owner's job by email", () => {
    expect(intents("We will not be proceeding with this job.", { fromPartner: true })).not.toContain("cancel");
  });
});

describe("reschedule / can't make it", () => {
  test("can't make the day → reschedule, never cancel", () => {
    expect(intents("Hi, I can't make it on Tuesday anymore, something came up at work. Could we do Thursday instead?")).toEqual(expect.arrayContaining(["reschedule"]));
    expect(intents("Please cancel Tuesday's appointment, can we do Thursday instead?")).toContain("reschedule");
    expect(intents("Please cancel Tuesday's appointment, can we do Thursday instead?")).not.toContain("cancel");
    const [r] = proposedChanges(mail("Can we reschedule the install to next week? Monday or Wednesday works."));
    expect(r).toMatchObject({ intent: "reschedule" });
    expect((r as { mentionedDays: string[] }).mentionedDays).toEqual(expect.arrayContaining(["next week", "monday", "wednesday"]));
  });
  test("a plain confirmation is not a reschedule", () => {
    expect(intents("Tuesday at 9 is perfect, see you then.")).toEqual([]);
  });
});

describe("new contact details", () => {
  test("new mobile and email are proposed", () => {
    const [c] = proposedChanges(mail("Just letting you know my new mobile is 0412 345 678 and please use jane.new@example.test from now on."));
    expect(c).toMatchObject({ intent: "contact_change", phone: "0412 345 678", email: "jane.new@example.test" });
  });
  test("+61 numbers normalise", () => {
    expect(normalisePhone("+61 412 345 678")).toBe("0412 345 678");
    expect(normalisePhone("(03) 9123 4567")).toBe("03 9123 4567");
    expect(normalisePhone("12345")).toBeNull();
  });
  test("a phone number in a signature alone is not a change", () => {
    expect(intents("Thanks for the update.\n\nKind regards\nSam Example\nM: 0412 345 678")).not.toContain("contact_change");
  });
});

describe("attachments", () => {
  test("a real attached file → attachment; inline signature images do not count", () => {
    const withFile = mail("Here are the photos of the roof space you asked for.", { hasAttachments: true, attachments: [{ name: "IMG_1234.jpg", contentType: "image/jpeg", isInline: false }, { name: "logo.png", isInline: true }] });
    const [a] = proposedChanges(withFile);
    expect(a).toMatchObject({ intent: "attachment", files: ["IMG_1234.jpg"] });
    expect(classifyEmailIntents(mail("Thanks!", { hasAttachments: true, attachments: [{ name: "logo.png", isInline: true }] })).map((h) => h.intent)).not.toContain("attachment");
  });
});

describe("questions and trades (no change raised)", () => {
  test("status / price / rebate questions", () => {
    expect(intents("Hi, any update on when the installer is coming? Haven't heard anything for a week.")).toContain("question_status");
    expect(intents("How much will the final price be after the rebate?")).toEqual(expect.arrayContaining(["question_price", "question_rebate"]));
    expect(proposedChanges(mail("How much will the final price be after the rebate?"))).toEqual([]);
  });
  test("installer / electrician mail", () => {
    expect(intents("This is the electrician — the PIESA form in Mitti won't submit for this job.")).toContain("trade");
    expect(intents("Can you send the job details?", { fromPartner: true })).toContain("trade");
  });
  test("outbound mail has no owner intent", () => {
    expect(classifyEmailIntents(mail("Please cancel", { direction: "outbound" }))).toEqual([]);
  });
});

test("labels, age limit and open requests", () => {
  expect(changeRequestLabel({ intent: "cancel" })).toBe("Owner asks to cancel");
  expect(changeRequestLabel({ intent: "contact_change", email: "a@b.test", phone: null })).toContain("a@b.test");
  const now = new Date("2026-10-24T00:00:00Z");
  expect(recentEnoughForAction("2026-10-20T00:00:00Z", now)).toBe(true);
  expect(recentEnoughForAction("2026-09-01T00:00:00Z", now)).toBe(false);
  expect(openChangeRequests([{ id: "a" }, { id: "b" }], [{ request_event_id: "a" }]).map((r) => r.id)).toEqual(["b"]);
});
