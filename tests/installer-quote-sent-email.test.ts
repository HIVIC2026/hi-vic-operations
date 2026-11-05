// "Quote sent" email to the installer's business office (Jo 5 Nov 2026 22:45): when an own-customer quote goes to the
// owner, the office gets ONE branded email. Pure: the approved wording, money and date formatting, the plan and the keys.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  INSTALLER_QUOTE_SENT_EMAIL_APPROVED, INSTALLER_QUOTE_SENT_EVENT, INSTALLER_QUOTE_SENT_HELD_EVENT, INSTALLER_QUOTE_SENT_PURPOSE,
  installerQuoteSentKey, installerQuoteSentLink, installerQuoteSentPlan, installerQuoteSentSubject, quoteSentDayLabel, quoteSentMoney,
  quoteSentShortDayLabel, renderInstallerQuoteSentEmail, type InstallerQuoteSentFacts,
} from "../src/lib/installer-quote-sent-email.core";
import { quoteExpiresAt } from "../src/lib/quote-expiry.core";
import { lastValidInstant } from "../src/lib/owner-quote-email.core";

// Sent Thu 5 Nov 2026 (Melbourne) → 30 days → last valid day Sat 5 Dec 2026.
const validUntil = lastValidInstant(quoteExpiresAt("2026-11-05T03:00:00Z", "2026-11-04T21:40:00Z"));

const sample: InstallerQuoteSentFacts = {
  recipientFirst: "Deep", ownerFirst: "Sarah", ownerFull: "Sarah Brown", jobNumber: "HV-1234",
  address: "12 Example St, Box Hill VIC 3128", totalIncGst: 4850, validUntil,
  quoteUrl: "https://estimate.homeinsulationvictoria.com.au/field/job-1",
};

describe("renderInstallerQuoteSentEmail — approved copy (Jo 5 Nov 2026 22:45)", () => {
  test("subject, preview and every approved line, exactly", () => {
    const m = renderInstallerQuoteSentEmail(sample);
    expect(m.subject).toBe("HV-1234: Quote sent to Sarah");
    expect(m.html).toContain("HV-1234 Quote sent — valid until 5 Dec 2026");
    for (const s of [
      "Hi Deep,", "Quote sent.", "The quote for Sarah's place went out today.",
      "HV-1234 · Sarah Brown", "12 Example St, Box Hill VIC 3128", "Quote: $4,850 inc GST", "Valid until Sat 5 Dec 2026",
      "We'll touch base with Sarah on day 3 and again 2 days before it expires. You'll hear from us the moment they accept or decline.",
      "See the quote: https://estimate.homeinsulationvictoria.com.au/field/job-1",
      "Home Insulation Victoria · VEU Accredited Person A003654", "DC Construction Solutions Pty Ltd · ABN 44 671 613 979",
    ]) expect(m.text, s).toContain(s);
    expect(m.html).toContain(`href="${sample.quoteUrl}"`);
    expect(m.html).toContain("See the quote");
    expect(m.html.trimStart()).toMatch(/^<!doctype html/i);
    // "they" — never a guessed gender.
    expect(`${m.text}\n${m.html}`).not.toMatch(/\b(she|he) accepts\b/);
    expect(m.mjml).toContain("<mj-button");
  });
  test("matches the approved design file's wording", () => {
    const design = readFileSync("docs/templates/mjml/installer_quote-sent.mjml", "utf8");
    const m = renderInstallerQuoteSentEmail(sample);
    for (const s of ["Quote sent.", "The quote for Sarah's place went out today.", "HV-1234 · Sarah Brown", "Quote: $4,850 inc GST", "Valid until Sat 5 Dec 2026", "See the quote"]) {
      expect(design, s).toContain(s);
      expect(m.text, s).toContain(s);
    }
    expect(design).toContain("<mj-title>HV-1234: Quote sent to Sarah</mj-title>");
    expect(design).toContain("<mj-preview>HV-1234 Quote sent — valid until 5 Dec 2026</mj-preview>");
  });
  test("no owner first name → 'the owner' everywhere, never a broken sentence; no signer → 'there'", () => {
    const m = renderInstallerQuoteSentEmail({ ...sample, recipientFirst: null, ownerFirst: null, ownerFull: "the owner" });
    expect(m.subject).toBe("HV-1234: Quote sent to the owner");
    expect(m.text).toContain("Hi there,");
    expect(m.text).toContain("The quote for the owner's place went out today.");
    expect(m.text).toContain("We'll touch base with the owner on day 3");
  });
  test("TEST sends are marked; real sends are not", () => {
    expect(renderInstallerQuoteSentEmail({ ...sample, test: true }).text).toContain("TEST — only sent to Jo.");
    expect(renderInstallerQuoteSentEmail(sample).text).not.toContain("TEST — only sent to Jo.");
  });
});

describe("money and date formatting (Melbourne)", () => {
  test("whole dollars have no cents; cents show two places", () => {
    expect(quoteSentMoney(4850)).toBe("$4,850");
    expect(quoteSentMoney(4850.5)).toBe("$4,850.50");
    expect(quoteSentMoney(12345.67)).toBe("$12,345.67");
  });
  test("'Fri 4 Dec 2026' from the last valid instant, in Melbourne time (DST-safe: 23:59:59 Melbourne = 12:59:59Z)", () => {
    expect(quoteSentDayLabel(new Date("2026-12-04T12:59:59.999Z"))).toBe("Fri 4 Dec 2026");
    expect(quoteSentShortDayLabel(new Date("2026-12-05T12:59:59.999Z"))).toBe("5 Dec 2026");
    // The same instant read in UTC would be the day before — the label must not slip.
    expect(quoteSentDayLabel(new Date("2026-12-04T13:00:00.000Z"))).toBe("Sat 5 Dec 2026");
    // Sent 5 Nov 2026 Melbourne → valid through Sat 5 Dec 2026 (decision #30: 30 full days).
    expect(quoteSentDayLabel(validUntil)).toBe("Sat 5 Dec 2026");
    // Winter (no DST): 23:59:59 Melbourne on 5 Jul = 13:59:59Z.
    expect(quoteSentDayLabel(new Date("2027-07-05T13:59:59.999Z"))).toBe("Mon 5 Jul 2027");
  });
  test("subject helper", () => {
    expect(installerQuoteSentSubject("HV-1", "Sarah")).toBe("HV-1: Quote sent to Sarah");
    expect(installerQuoteSentSubject("HV-1", "  ")).toBe("HV-1: Quote sent to the owner");
  });
});

describe("plan: own-customer installation quotes only; held reasons; one attempt per quote", () => {
  const ok = { channel: "installer_sourced", kind: "installation", sentAt: "2026-11-05T03:00:00Z", deleted: false, approved: true, test: false, officeEmail: "office@sample.example", paused: null, alreadyAttempted: false };
  test("a real partner with an office email → send", () => {
    expect(installerQuoteSentPlan(ok)).toEqual({ action: "send", to: "office@sample.example" });
  });
  test("HIV leads, fixes quotes, unsent quotes and closed jobs: nothing, ever", () => {
    expect(installerQuoteSentPlan({ ...ok, channel: "hivic_sourced" })).toEqual({ action: "skip", reason: "not an installer's own customer" });
    expect(installerQuoteSentPlan({ ...ok, channel: null })).toMatchObject({ action: "skip" });
    expect(installerQuoteSentPlan({ ...ok, kind: "rectification" })).toEqual({ action: "skip", reason: "not an installation quote" });
    expect(installerQuoteSentPlan({ ...ok, sentAt: null })).toEqual({ action: "skip", reason: "quote not sent to the owner" });
    expect(installerQuoteSentPlan({ ...ok, deleted: true })).toEqual({ action: "skip", reason: "job closed" });
  });
  test("idempotent: an existing attempt is done, whatever else is true", () => {
    expect(installerQuoteSentPlan({ ...ok, alreadyAttempted: true })).toEqual({ action: "done" });
    expect(installerQuoteSentPlan({ ...ok, alreadyAttempted: true, officeEmail: null })).toEqual({ action: "done" });
  });
  test("held: flag off (real partners only), no office email, trade messages paused", () => {
    expect(installerQuoteSentPlan({ ...ok, approved: false })).toEqual({ action: "held", reason: "email wording not approved yet (INSTALLER_QUOTE_SENT_EMAIL_APPROVED)" });
    expect(installerQuoteSentPlan({ ...ok, officeEmail: "  " })).toEqual({ action: "held", reason: "no office email on file for the installer" });
    expect(installerQuoteSentPlan({ ...ok, paused: "Trade messages are paused" })).toEqual({ action: "held", reason: "Trade messages are paused" });
  });
  test("TEST job / TEST partner → test-send even while the flag is off; pause never holds TEST", () => {
    expect(installerQuoteSentPlan({ ...ok, test: true, approved: false })).toEqual({ action: "test_send", to: "office@sample.example" });
  });
  test("the flag is ON (Jo 5 Nov 2026 22:45), keys and event names", () => {
    expect(INSTALLER_QUOTE_SENT_EMAIL_APPROVED).toBe(true);
    expect(installerQuoteSentKey("q-1")).toBe("installer-quote-sent:v1:q-1");
    expect(installerQuoteSentLink("https://estimate.homeinsulationvictoria.com.au/", "job-1")).toBe("https://estimate.homeinsulationvictoria.com.au/field/job-1");
    expect(INSTALLER_QUOTE_SENT_EVENT).toBe("installer_quote_sent_email");
    expect(INSTALLER_QUOTE_SENT_HELD_EVENT).toBe("installer_quote_sent_email_held");
    expect(INSTALLER_QUOTE_SENT_PURPOSE).toBe("installer_quote_sent_email");
  });
  test("Lovable's unused draft is gone from own-customer-ready-check-copy.core", () => {
    const s = readFileSync("src/lib/own-customer-ready-check-copy.core.ts", "utf8");
    expect(s).not.toContain("installerQuoteSentDraft");
    expect(s).not.toContain("INSTALLER_QUOTE_SENT_EMAIL_APPROVED");
  });
});
