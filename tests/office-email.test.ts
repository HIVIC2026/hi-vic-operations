import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OFFICE_REPLY_TO, officeEmailBlocker, officeEmailCopy, officeEmailTo } from "../src/lib/office-email.core";
import { testSendBlocker } from "../src/lib/test-send.core";

const kylie = "kyliematthews5@bigpond.com";
describe("Jo's own office emails to partners (7 Oct)", () => {
  test("a manual office email to an applicant sends to the real address", () => {
    expect(officeEmailBlocker({ origin: "office_manual", recipient: "applicant", to: kylie, message: "Quick question about your rates" })).toBeNull();
    expect(officeEmailBlocker({ origin: "office_manual", recipient: "partner", to: kylie, message: "Hi" })).toBeNull();
    expect(officeEmailTo(" KylieMatthews5@bigpond.com ", false)).toBe(kylie);
  });
  test("an automated email to the same address is still blocked", () => {
    expect(officeEmailBlocker({ origin: "automated", recipient: "applicant", to: kylie, message: "x" })).not.toBeNull();
    expect(testSendBlocker({ channel: "email", to: kylie, jobSource: null, partnerIsTest: false })).not.toBeNull();
    expect(testSendBlocker({ channel: "email", to: kylie, jobSource: null, partnerIsTest: true })).not.toBeNull();
  });
  test("homeowner emails are still blocked", () => {
    expect(officeEmailBlocker({ origin: "office_manual", recipient: "homeowner", to: "owner@example.com", message: "x" })).not.toBeNull();
    expect(testSendBlocker({ channel: "email", to: "owner@example.com", jobSource: "base44", partnerIsTest: false })).not.toBeNull();
  });
  test("blank message or address is refused in plain words", () => {
    expect(officeEmailBlocker({ origin: "office_manual", recipient: "applicant", to: kylie, message: "  " })).toBe("Type a message first.");
    expect(officeEmailBlocker({ origin: "office_manual", recipient: "applicant", to: "", message: "x" })).toMatch(/no valid email/);
  });
  test("automatic test-run applications go only to Jo's test inbox", () => {
    expect(officeEmailTo(kylie, true)).toBe("jolowexo@hotmail.com");
  });
  test("reply-to is the office, recipient comes from the record, sends are recorded", () => {
    expect(OFFICE_REPLY_TO).toBe("info@homeinsulationvictoria.com.au");
    const srv = readFileSync("src/lib/office-email.server.ts", "utf8");
    expect(srv).toContain("reply_to: OFFICE_REPLY_TO");
    expect(srv).toContain('event_type: "office_manual_email"');
    const fn = readFileSync("src/lib/partner-activation.functions.ts", "utf8");
    const i = fn.indexOf("sendPartnerOfficeEmail"); expect(fn.slice(i, i + 400)).not.toMatch(/\bto: z\./);
    expect(officeEmailCopy({ contactName: "Kylie Matthews", subject: "", message: "Hi\\n\\nThanks" }).heading).toBe("Hi Kylie,");
  });
});
