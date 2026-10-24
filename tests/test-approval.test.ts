import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { enquiryStatusBlocker, testAbn, testApprovalBlocker, testBusinessName, testLoginEmail, testWelcomeCopy } from "../src/lib/test-approval.core";
import { isTestPartner, testSendBlocker } from "../src/lib/test-send.core";

describe("approving Jo's own TEST application (7 Oct)", () => {
  test("test-marked applications can be approved; automatic test runs cannot", () => {
    expect(testApprovalBlocker({ testMode: false })).toBeNull();
    expect(testApprovalBlocker({ testMode: true })).toMatch(/never be approved/);
  });
  test("TEST ABN is 12 digits, so it never matches a real 11-digit ABN", () => {
    const a = testAbn("0eabd42b-702f-4c28-b4bb-c80d7dd1ec49");
    expect(a).toMatch(/^999\d{9}$/);
    expect(a.length).toBe(12);
  });
  test("TEST business is marked, so real jobs are never offered to it", () => {
    expect(testBusinessName("J")).toBe("[TEST PARTNER] J");
    expect(isTestPartner({ onboarding_notes: "[TEST PARTNER] Jo's own test application" })).toBe(true);
  });
  test("welcome goes only to Jo's allowlisted inbox; the login is a plus-alias", () => {
    expect(testLoginEmail("0eabd42b-702f-4c28")).toBe("jolowexo+app0eabd42b@hotmail.com");
    expect(testSendBlocker({ channel: "email", to: "jolowexo@hotmail.com", jobSource: null, partnerIsTest: true })).toBeNull();
    expect(testSendBlocker({ channel: "email", to: "jo@actpropertyinspections.com.au", jobSource: null, partnerIsTest: true })).toBeNull();
    expect(testSendBlocker({ channel: "email", to: "info@reinsulate.com.au", jobSource: null, partnerIsTest: true })).not.toBeNull();
    expect(testSendBlocker({ channel: "email", to: "jolowexo@hotmail.com", jobSource: null, partnerIsTest: false })).not.toBeNull();
    const c = testWelcomeCopy({ firstName: "Jo", businessName: "[TEST PARTNER] J", link: "https://x/reset-password?t=1", loginEmail: "jolowexo+app1@hotmail.com" });
    expect(c.button.url).toContain("/reset-password");
    expect(c.paragraphs.join(" ")).toContain("jolowexo+app1@hotmail.com");
    expect(c.paragraphs.join(" ")).not.toContain("[TEST PARTNER]");
  });
  test("enquiry dropdown can't fake an approval of a signed application", () => {
    expect(enquiryStatusBlocker({ status: "approved", hasSignedApplication: true })).toMatch(/Approve partner/);
    expect(enquiryStatusBlocker({ status: "approved", hasSignedApplication: false })).toBeNull();
    expect(enquiryStatusBlocker({ status: "contacted", hasSignedApplication: true })).toBeNull();
  });
  test("real partners: welcome stays queued, never sent", () => {
    const f = readFileSync("src/lib/partner-activation.functions.ts", "utf8");
    expect(f).toContain("await queueApprovalMessage(admin, r.business_id);");
    expect(f.indexOf("if (isTest) {\n      const d")).toBeLessThan(f.indexOf("await queueApprovalMessage(admin, r.business_id);"));
  });
});

describe("one clear Approve (7 Oct)", () => {
  const ui = readFileSync("src/components/portal/partner-application.tsx", "utf8"); // moved from admin.partners.tsx (O5 build B)
  test("the status row can't mark an enquiry approved", () => {
    expect(ui).toContain('PARTNER_STATUSES.filter((s) => s !== "approved")');
  });
  test("one Approve button, rate panel's own activate hidden, checklist first", () => {
    expect(ui).toContain("showActivate={false}");
    expect((ui.match(/onClick=\{onActivate\}/g) ?? []).length).toBe(0);
    expect(ui).toContain("getApprovalChecklist");
    expect(ui).toContain("Still to do before approving:");
  });
  test("after approval: login link with Copy link while sending is off", () => {
    expect(ui).toContain("Copy link");
    expect(ui).toContain("Send login link"); // Jo 7 Oct login rule: partner login links really send (manual partner email).
  });
});
