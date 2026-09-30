import { describe, expect, test } from "bun:test";
import { renderCoverageUnavailableEmail } from "../src/lib/coverage-email";
import { emailSuppression, withUnsubscribe } from "../src/lib/emailsafety.core";

describe("service-area customer update", () => {
  test("names only the unavailable trade and makes no payment request", () => {
    const mail = renderCoverageUnavailableEmail({ firstName: "Jo", suburb: "Sale", postcode: "3850", missing: ["installer"], reference: "HV-1001" });
    expect(mail.subject).toContain("Sale 3850");
    expect(mail.plainText).toContain("approved installer with verified coverage");
    expect(mail.plainText).toContain("do not need to pay anything");
    expect(mail.plainText).not.toContain("Ready Check");
    expect(mail.plainText).not.toContain("$220");
  });

  test("adds the mandatory unsubscribe footer", () => {
    const mail = withUnsubscribe(renderCoverageUnavailableEmail({ missing: ["REC / electrician", "installer"] }), "https://quote.homeinsulationvictoria.com.au/api/public/unsubscribe?t=abcdefghijklmnopqrstuvwx");
    expect(mail.html).toContain("Unsubscribe");
    expect(mail.plainText).toContain("/api/public/unsubscribe");
  });

  test("remains suppressed for opted-out, bounced, test and old enquiries", () => {
    const base = { purpose: "area_unavailable" as const, optedOut: false, bounced: false, stage: "new_enquiry", jobSource: "base44", jobCreatedAt: "2026-09-29", recipient: "owner@example.com.au", jobsCreatedAfter: "2026-09-01", now: Date.parse("2026-09-30") };
    expect(emailSuppression({ ...base, optedOut: true })).toBe("unsubscribed");
    expect(emailSuppression({ ...base, bounced: true })).toBe("bounced");
    expect(emailSuppression({ ...base, recipient: "qa@example.com" })).toBe("test_or_example_recipient");
    expect(emailSuppression({ ...base, jobCreatedAt: "2026-08-01" })).toBe("backlog_before_cutoff");
  });
});