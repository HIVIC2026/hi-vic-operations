import { describe, expect, test } from "bun:test";
import { partnerWelcomeEmail } from "../src/lib/partner-email.core";
import { declineEmail, changesEmail, renderApplicationReceivedEmail, APPLICATION_RECEIVED_EMAIL_APPROVED } from "../src/lib/application-review.core";
import { FOOTER_TEXT } from "../src/lib/email-kit.core";
import { MAIL_LOGO_URL } from "../src/lib/mail-mjml.core";

describe("partner emails (Jo 8 Oct wording; decision 107/136/137 designs)", () => {
  const w = (trade: "installer" | "electrician") => partnerWelcomeEmail({ firstName: "Sam", businessName: "Acme Insulation", trade, email: "sam@acme.test", link: "https://x.test/l", test: false });
  test("welcome (I54): headline, three benefits, Set your password, the 2-minute guide card", () => {
    const i = w("installer"), e = w("electrician");
    expect(i.subject).toBe("You're approved — welcome to Home Insulation Victoria");
    expect(i.text).toContain("Welcome aboard, Sam.\n\nYou're approved!");
    expect(i.html).toContain(">Welcome aboard, Sam.<");
    expect(i.html).toContain(">You're approved!<");
    expect(i.html).toContain("Acme Insulation can now take VEU ceiling insulation jobs through Home Insulation Victoria.");
    expect(i.text).toContain("✓ Jobs sent to you, plus add your own customers");
    expect(i.text).toContain("✓ Your price, never marked up. We only add our $349 AP fee");
    expect(e.text).toContain("✓ PIESAs sent to you near where you work");
    expect(i.text).toContain("Set your password: https://x.test/l");
    expect(i.text).toContain("You'll sign in with sam@acme.test. The link works once and lasts 24 hours.");
    expect(i.html).toContain("New to how we work?");
    expect(i.html).toContain("Read the guide &rarr;");
    expect(i.html).toContain('href="https://estimate.homeinsulationvictoria.com.au/field/guide"');
    expect(i.text).toContain("Questions? Just reply to this email.");
    expect(i.html).not.toContain("TEST — only sent to Jo");
  });
  test("all partner emails share the MJML frame (hosted logo, AP/ABN footer, no unsubscribe link)", () => {
    for (const m of [w("installer"), declineEmail({ contactName: "Sam", test: false }), changesEmail({ contactName: "Sam", message: "Fix ABN", link: "https://x.test", test: false }), renderApplicationReceivedEmail({ contactName: "Sam", businessName: "Reinsulate" })]) {
      expect(m.html).toContain(`src="${MAIL_LOGO_URL}"`);
      expect(m.html).not.toContain("data:image");
      expect(m.html).toContain("Home Insulation Victoria · VEU Accredited Person A003654<br />DC Construction Solutions Pty Ltd · ABN 44 671 613 979");
      expect(m.text).toContain(FOOTER_TEXT);
      expect(m.html).not.toContain(">Unsubscribe</a>");
      expect(m.html).toContain("Figtree,Arial,Helvetica,sans-serif");
    }
  });
  test("application received (I53): three steps, approved (decision 136)", () => {
    const m = renderApplicationReceivedEmail({ contactName: "Sam Lee", businessName: "Reinsulate" });
    expect(m.subject).toBe("We've got your application");
    expect(m.html).toContain(">Thanks Sam,<");
    expect(m.html).toContain(">We've got your application<");
    for (const t of ["We check your details", "CII certification and public liability insurance (min $5 million).", "You're approved", "invite to Mitti", "Start adding jobs", "If anything's missing, we'll email you exactly what we need."]) expect(m.text).toContain(t);
    expect(APPLICATION_RECEIVED_EMAIL_APPROVED).toBe(true); // decision 136
  });
});
