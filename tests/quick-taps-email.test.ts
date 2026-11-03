// Quick taps email (Jo 2 Nov 2026): the owner's email with the quick taps link, plus the day-2 reminder, and their Template hub entries.
import { describe, expect, test } from "bun:test";
import { QUICK_TAPS_EMAIL_BUTTON, QUICK_TAPS_EMAIL_SUBJECT, QUICK_TAPS_REMINDER_EMAIL_SUBJECT, renderQuickTapsEmail } from "../src/lib/quick-taps-email.core";

const link = "https://example.test/my-job/abc?screen=taps";
const unsub = "https://example.test/unsubscribe?t=XYZ";

describe("renderQuickTapsEmail", () => {
  test("first email", () => {
    const m = renderQuickTapsEmail({ firstName: "Dev Govekar", link, unsubscribeUrl: unsub, reminder: false });
    expect(m.subject).toBe("It's almost time for your free Ready Check");
    expect(QUICK_TAPS_EMAIL_SUBJECT).toBe(m.subject);
    expect(QUICK_TAPS_EMAIL_BUTTON).toBe("Confirm my details");
    expect(m.text).toContain("Hi Dev, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote.");
    expect(m.text).toContain(`Confirm my details: ${link}`);
    expect(m.text).toContain("Home Insulation Victoria");
    expect(m.html).toContain(`href="${link}"`);
    expect(m.html).toContain(unsub);
  });
  test("reminder", () => {
    const m = renderQuickTapsEmail({ firstName: "Dev Govekar", link, unsubscribeUrl: unsub, reminder: true });
    expect(m.subject).toBe("Just a reminder - confirm your details");
    expect(QUICK_TAPS_REMINDER_EMAIL_SUBJECT).toBe(m.subject);
    expect(m.text).toContain("Hi Dev, just a reminder - please confirm a few quick details so we can book your free Ready Check.");
  });
  test("no first name", () => {
    expect(renderQuickTapsEmail({ firstName: null, link, unsubscribeUrl: unsub, reminder: false }).text.startsWith("Hi there, great news")).toBe(true);
    expect(renderQuickTapsEmail({ firstName: null, link, unsubscribeUrl: null, reminder: true }).text).toContain("Hi there, just a reminder - ");
  });
});

// The Templates hub entries for this email (owner:quick-taps-email / owner:quick-taps-reminder-email) were retired at the
// 4 Nov 2026 join: the O77 "It's your turn" email opens the quick taps (decision #22); the builder stays for history.
