// Decisions 54–58 item 3 (Jo 2 Nov 2026): the change/cancel reply sends the owner to the trade's OFFICE phone —
// "Call {installer/electrician} on {office phone} to change it. To cancel, just reply to this email." — with no job page
// link. No office phone on file → the reply is held (existing EMAIL_CHANGE_REPLY_HELD_EVENT path), never a blank or a mobile.
// Run: bun test tests/email-change-reply-office-phone.test.ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { changeReplyBusiness, changeReplyRole, changeReplyText, renderChangeReplyEmail } from "../src/lib/email-change-reply.core";

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("change/cancel reply wording (item 3)", () => {
  test("change/cancel reply (item 3)", () => {
    const t = changeReplyText({ firstName: "Sarah", visit: "piesa", business: "Sparky Co", officePhone: "03 9111 1111" });
    expect(t).toContain("Call Sparky Co on 03 9111 1111 to change it. To cancel, just reply to this email.");
    expect(t).not.toMatch(/job page|my-job/);
  });
  test("greeting, No problem, the one sentence, sign-off — and the email has no button or link", () => {
    expect(changeReplyText({ firstName: null, visit: "install", business: "Rapid Insulation", officePhone: "03 9000 0000" })).toBe(
      "Hi there,\n\nNo problem\n\nCall Rapid Insulation on 03 9000 0000 to change it. To cancel, just reply to this email.\n\n— Home Insulation Victoria");
    const m = renderChangeReplyEmail({ firstName: "Sarah", visit: "ready_check", business: "Rapid Insulation", officePhone: "03 9000 0000", theirSubject: "Change", unsubscribe: null });
    expect(m.subject).toBe("Re: Change");
    expect(m.html).toContain("Call Rapid Insulation on 03 9000 0000 to change it. To cancel, just reply to this email.");
    expect(m.html).not.toMatch(/my-job|job page|Change my|Or open this link/);
  });
});

describe("who to call: the business office phone only", () => {
  test("electrician for the safety check, installer otherwise", () => {
    expect(changeReplyRole("piesa")).toBe("electrician");
    expect(changeReplyRole("install")).toBe("installer");
    expect(changeReplyRole("ready_check")).toBe("installer");
  });
  test("trading name first, else the name; no contact or no office phone → null (held)", () => {
    expect(changeReplyBusiness({ name: "Sparky Pty Ltd", tradingName: "Sparky Co", officePhone: "03 9111 1111", email: null })).toEqual({ business: "Sparky Co", officePhone: "03 9111 1111" });
    expect(changeReplyBusiness({ name: "Sparky Pty Ltd", tradingName: null, officePhone: "03 9111 1111", email: null })).toEqual({ business: "Sparky Pty Ltd", officePhone: "03 9111 1111" });
    expect(changeReplyBusiness(null)).toBeNull();
    expect(changeReplyBusiness({ name: "Sparky Pty Ltd", tradingName: "Sparky Co", officePhone: null, email: "a@b.c" })).toBeNull();
    expect(changeReplyBusiness({ name: "Sparky Pty Ltd", tradingName: "Sparky Co", officePhone: "  ", email: "a@b.c" })).toBeNull();
  });
  test("server: reads businessContactForJob before the claim; missing → held event + office row, nothing sent", () => {
    const s = strip(readFileSync("src/lib/email-change-reply.server.ts", "utf8"));
    expect(s).toContain("businessContactForJob(jobId, changeReplyRole(plan.visit))");
    const lookup = s.indexOf("changeReplyBusiness(");
    const held = s.indexOf("EMAIL_CHANGE_REPLY_HELD_EVENT", lookup);
    expect(lookup).toBeGreaterThan(0);
    expect(lookup).toBeLessThan(s.indexOf("EMAIL_CHANGE_REPLIED_EVENT, `Owner emailed"));
    expect(held).toBeGreaterThan(lookup);
    expect(held).toBeLessThan(s.indexOf("EMAIL_CHANGE_REPLIED_EVENT, `Owner emailed"));
    expect(s).not.toMatch(/partner_workers|profiles"\)|mobile/);
  });
});
