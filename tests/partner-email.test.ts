import { describe, expect, test } from "bun:test";
import { partnerWelcomeEmail, PARTNER_EMAIL_LOGO_URL } from "../src/lib/partner-email.core";
import { declineEmail, changesEmail } from "../src/lib/application-review.core";

describe("partner emails (Jo 8 Oct)", () => {
  const w = (trade: "installer" | "electrician") => partnerWelcomeEmail({ firstName: "Sam", businessName: "Acme Insulation", trade, email: "sam@acme.test", link: "https://x.test/l", test: false });
  test("exact welcome wording and trade line", () => {
    const i = w("installer"), e = w("electrician");
    expect(i.subject).toBe("You're approved — welcome to Home Insulation Victoria");
    expect(i.text).toContain("Hi Sam,\n\nGreat news — Acme Insulation is now an approved Home Insulation Victoria partner.");
    expect(i.text).toContain("• see and accept insulation jobs near you");
    expect(e.text).toContain("• see and accept electrical safety checks near you");
    expect(i.text).toContain("Tap below to set your password. The link works once and lasts 24 hours.");
    expect(i.text).toContain("Set up my account: https://x.test/l");
    expect(i.text).toContain("You'll sign in with: sam@acme.test");
    expect(i.text).toContain("Welcome aboard,\nJo\nHome Insulation Victoria");
    expect(i.html).not.toContain("TEST — only sent to Jo");
  });
  test("all partner emails share the logo, font and 16px dark-grey body", () => {
    for (const m of [w("installer"), declineEmail({ contactName: "Sam", test: false }), changesEmail({ contactName: "Sam", message: "Fix ABN", link: "https://x.test", test: false })]) {
      expect(m.html).toContain(`<img src="${PARTNER_EMAIL_LOGO_URL}" alt="Home Insulation Victoria"`);
      expect(m.html).toMatch(/^https:\/\//.test(PARTNER_EMAIL_LOGO_URL) ? /font-size:16px;line-height:1.6;color:#333A40/ : /never/);
      expect(m.html).toContain("Helvetica, Arial, sans-serif");
    }
  });
});
