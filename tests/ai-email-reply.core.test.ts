import { describe, expect, test } from "bun:test";
import { AI_SIGN_OFF, aiReplyProblems, aiSendQuietReason, bookingChangeLink, finishAiReply } from "../src/lib/ai-email-reply.core";

const MY = "https://estimate.homeinsulationvictoria.com.au/my-job/TOK";
describe("AI email replies — Jo 26 Oct rules", () => {
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
  const { aiReplyEmailHtml } = require("../src/lib/ai-email-reply.core");
  const { MAIL_LOGO_URL } = require("../src/lib/mail-mjml.core");
  const render = (b: string) => aiReplyEmailHtml(b, { subject: "Re: Ready Check", unsubscribe: null });
  const out = finishAiReply(`Hi Sarah! Good news — your Ready Check's done. You can change the time here: ${MY}?screen=book.`);
  test("greeting gets its own line", () => expect(out.startsWith("Hi Sarah!\n\nGood news")).toBe(true));
  test("links sit on their own line", () => expect(out).toContain(`here:\n\n${MY}?screen=book\n\n`));
  test("links become a button, not a raw URL in the sentence", () => {
    const html = render(out);
    expect(html).toContain("Change my booking time");
    expect(html).toContain(`href="${MY}?screen=book"`);
  });
  test("sign-off on its own lines", () => expect(render(out)).toContain("Cheers,<br />the Home Insulation Victoria team"));
  test("refreshed look: hosted logo, no embedded image", () => { const h = render(out); expect(h).toContain(MAIL_LOGO_URL); expect(h).not.toContain("data:image"); });
});

describe("latestDraftEdits (Jo 27 Oct 2026: edits survive a refresh)", () => {
  test("keeps the newest edit per draft", async () => {
    const { latestDraftEdits } = await import("../src/lib/ai-email-reply.core");
    const m = latestDraftEdits([
      { created_at: "2026-10-27T11:00:00Z", details: { draft_event_id: "a", body: "first" } },
      { created_at: "2026-10-27T11:05:00Z", details: { draft_event_id: "a", body: "second" } },
      { created_at: "2026-10-27T11:02:00Z", details: { draft_event_id: "b", body: "only" } },
      { created_at: "2026-10-27T11:09:00Z", details: { draft_event_id: "c" } },
    ]);
    expect(m.get("a")).toBe("second");
    expect(m.get("b")).toBe("only");
    expect(m.has("c")).toBe(false);
  });
});

describe("Jo's tone (27 Oct 2026)", () => {
  test("an old 'Kind regards, Jo' sign-off is replaced by the team sign-off, not doubled", async () => {
    const { finishAiReply, AI_SIGN_OFF: S } = await import("../src/lib/ai-email-reply.core");
    const out = finishAiReply("Hi Sam,\n\nThanks for asking.\n\nKind regards,\nJo\nHome Insulation Victoria");
    expect(out.split(S).length).toBe(2);
    expect(out.endsWith(S)).toBe(true);
  });
  test("save link and electrician link get clear buttons", async () => {
    const { aiLinkLabel } = await import("../src/lib/ai-email-reply.core");
    expect(aiLinkLabel("https://estimate.homeinsulationvictoria.com.au/estimate/abc/campaign")).toBe("Save my free spot");
    expect(aiLinkLabel("https://portal.homeinsulationvictoria.com.au/electrician-onboarding")).toBe("Sign up as an electrician");
  });
  test("instructions carry Jo's rules", async () => {
    const { AI_REPLY_INSTRUCTIONS, AI_BUSINESS_RULES, NO_REPLY_NEEDED } = await import("../src/lib/ai-email-reply.core");
    expect(AI_REPLY_INSTRUCTIONS).toContain("Never say \"No worries\"");
    expect(AI_REPLY_INSTRUCTIONS).toContain(NO_REPLY_NEEDED);
    expect(AI_REPLY_INSTRUCTIONS).toContain("Keep it relevant");
    expect(AI_BUSINESS_RULES.join(" ")).toContain("$15/m²");
  });
});

// Step 3 final review fixes (I2b, I2c, I4).
describe("final review: Jo sign-offs are stripped", async () => {
  const { finishAiReply: finish, stripSignOff: strip, AI_SIGN_OFF: S } = await import("../src/lib/ai-email-reply.core");
  for (const so of ["Kind regards,\nJo", "Cheers, Jo", "Cheers,\n\nJo", "Thanks,\nJo :)", "Cheers Jo!"]) {
    test(`finishAiReply: ${JSON.stringify(so)}`, () => {
      const out = finish(`Hi Sam,\n\nAll good.\n\n${so}`);
      expect(out).toBe(`Hi Sam,\n\nAll good.\n\n${S}`);
    });
    test(`stripSignOff: ${JSON.stringify(so)}`, () => expect(strip(`Hi Sam,\n\nAll good.\n\n${so}`)).toBe("Hi Sam,\n\nAll good."));
  }
});

describe("final review: placeholders and owner wording", () => {
  for (const ph of ["<name>", "<address>", "<suburb>", "<postcode>", "<link>", "<email>", "<phone>", "<job>"]) {
    test(`flags ${ph}`, () => expect(aiReplyProblems(`Hi ${ph},\n\nAll good.`)).toContain(`Take out the placeholder ${ph} — write the real wording`));
  }
  test("flags fixes", () => {
    expect(aiReplyProblems("Hi Sam,\n\nThe fixes are quoted separately.", { aiDraft: true })).toContain("Say “electrical upgrades” instead of “fixes”.");
    expect(aiReplyProblems("Hi Sam,\n\nThey need fixing first.", { aiDraft: true })).toEqual([]);
  });
  test("flags a safety check with no PIESA", () => {
    expect(aiReplyProblems("Hi Sam,\n\nThe safety check is $349.", { aiDraft: true })).toContain("Say “electrical safety check (PIESA)”.");
    expect(aiReplyProblems("Hi Sam,\n\nThe electrical safety check (PIESA) is $349. The safety check is quick.", { aiDraft: true })).toEqual([]);
  });
});

// Jo 30 Oct 2026: the two wording rules are for the AI's own drafts only; Jo's typed words send as written.
describe("aiReplyProblems: wording rules only for the AI's own draft", () => {
  test("without aiDraft, fixes and a bare safety check are not flagged", () => {
    expect(aiReplyProblems("Hi Sam,\n\nThe fixes are quoted separately.")).toEqual([]);
    expect(aiReplyProblems("Hi Sam,\n\nThe safety check is $349.")).toEqual([]);
    expect(aiReplyProblems("Hi Sam,\n\nThe fixes and the safety check.", { preRelease: false, aiDraft: false })).toEqual([]);
  });
  test("with aiDraft true both are flagged", () => {
    const p = aiReplyProblems("Hi Sam,\n\nThe fixes and the safety check.", { aiDraft: true });
    expect(p).toContain("Say “electrical upgrades” instead of “fixes”.");
    expect(p).toContain("Say “electrical safety check (PIESA)”.");
  });
  test("other rules still apply without aiDraft", () => {
    expect(aiReplyProblems("Hi Sam,\n\nYour VEEC and fixes. Ring us on 03 9123 4567.").length).toBeGreaterThanOrEqual(2);
  });
});
