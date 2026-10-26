import { describe, expect, test } from "bun:test";
import { AI_EMAIL_AUTO_SEND_ENABLED, AI_SIGN_OFF, aiReplyProblems, aiSendQuietReason, bookingChangeLink, finishAiReply } from "../src/lib/ai-email-reply.core";

const MY = "https://estimate.homeinsulationvictoria.com.au/my-job/TOK";
describe("AI email replies — Jo 26 Oct rules", () => {
  test("auto-send stays off until Jo says send", () => expect(AI_EMAIL_AUTO_SEND_ENABLED).toBe(false));
  test("sign-off is added exactly once", () => {
    const out = finishAiReply("Hi Sarah!\nAll good.\n\nCheers,\nThe Home Insulation Victoria team");
    expect(out.endsWith(AI_SIGN_OFF)).toBe(true);
    expect(out.split(AI_SIGN_OFF).length).toBe(2);
    expect(out).not.toMatch(/Cheers,\nThe/);
  });
  test("says rebate, never VEECs", () => expect(finishAiReply("Your VEECs cover most of it.")).toContain("Your rebate cover"));
  test("never asks owners to call us or gives a phone number", () => {
    const out = finishAiReply("Booked for Tuesday. Feel free to call us on 0412 345 678 anytime.");
    expect(out).not.toMatch(/call us/i);
    expect(out).not.toMatch(/0412/);
    expect(aiReplyProblems("ring us on 03 9123 4567")).toHaveLength(2);
  });
  test("change link: PIESA and install open the booking screen, Ready Check the job home", () => {
    expect(bookingChangeLink(MY, "piesa_scheduled")?.link).toBe(`${MY}?screen=book`);
    expect(bookingChangeLink(MY, "piesa_scheduled")?.visit).toBe("piesa");
    expect(bookingChangeLink(MY, "installation_booked")?.visit).toBe("install");
    expect(bookingChangeLink(null, "piesa_scheduled")).toBeNull();
  });
  test("no owner emails after 8pm Melbourne", () => {
    expect(aiSendQuietReason("2026-10-26T10:30:00Z")).not.toBeNull(); // 9:30pm AEDT
    expect(aiSendQuietReason("2026-10-26T01:00:00Z")).toBeNull(); // 12pm AEDT
  });
});

describe("AI reply layout (Jo 26 Oct)", () => {
  const K = require("../src/lib/email-kit.core");
  const { aiReplyHtmlBody } = require("../src/lib/ai-email-reply.core");
  const out = finishAiReply(`Hi Sarah! Good news — your Ready Check's done. You can change the time here: ${MY}?screen=book.`);
  test("greeting gets its own line", () => expect(out.startsWith("Hi Sarah!\n\nGood news")).toBe(true));
  test("links sit on their own line", () => expect(out).toContain(`here:\n\n${MY}?screen=book\n\n`));
  test("links become a button, not a raw URL in the sentence", () => {
    const html = aiReplyHtmlBody(out, K);
    expect(html).toContain("Change my booking time");
    expect(html).toContain(`href="${MY}?screen=book"`);
  });
  test("sign-off on its own lines", () => expect(aiReplyHtmlBody(out, K)).toContain("Cheers,<br>the Home Insulation Victoria team"));
});
