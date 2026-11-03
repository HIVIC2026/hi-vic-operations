import { describe, expect, test } from "bun:test";
import {
  contactConsentRecord, contactConsentSnapshot, phoneConsentCurrent, PHONE_CONSENT_MONTHS, WEBSITE_CONSENT_WORDING, WEBSITE_CONSENT_LIVE_FROM_ISO,
  websiteConsentWording,
} from "../src/lib/contact-consent-record.core";
import { planContactConsent } from "../src/lib/enquiry.core";

const s = contactConsentSnapshot({ who: ["Home Insulation Victoria", "Rapid Insulation"], givenAt: "2026-11-02T01:00:00Z", wording: "x" });

describe("contact consent record", () => {
  test("snapshot names who, why, how and until when", () => {
    expect(s.who).toEqual(["Home Insulation Victoria", "Rapid Insulation"]);
    expect(s.purpose).toBe("to book and carry out ceiling insulation under the Victorian Energy Upgrades program");
    expect(s.methods).toEqual(["phone", "visit"]);
    expect(s.expiresAt.slice(0, 10)).toBe("2027-02-02");
    expect(s.wording).toBe("x");
    expect(PHONE_CONSENT_MONTHS).toBe(3);
  });
  test("month end is clamped", () => {
    expect(contactConsentSnapshot({ who: [], givenAt: "2026-11-30T01:00:00Z", wording: "" }).expiresAt.slice(0, 10)).toBe("2027-02-28");
  });
  test("phone consent lasts 3 months", () => {
    expect(phoneConsentCurrent("2026-08-01T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(false);
    expect(phoneConsentCurrent("2026-08-03T00:00:00Z", "2026-11-02T00:00:00Z")).toBe(true);
    expect(phoneConsentCurrent(null, "2026-11-02T00:00:00Z")).toBe(false);
  });
  test("record shows withdrawal date (latest do-not-contact)", () => {
    const r = contactConsentRecord([{ consented_at: "2026-11-02T01:00:00Z", snapshot: s, source: "website" }], [
      { event_type: "owner_do_not_contact_set", created_at: "2026-11-10T00:00:00Z" },
      { event_type: "owner_do_not_contact_set", created_at: "2026-11-20T00:00:00Z" },
      { event_type: "other", created_at: "2026-12-01T00:00:00Z" },
    ]);
    expect(r?.withdrawnAt).toBe("2026-11-20T00:00:00Z");
    expect(r?.who).toEqual(["Home Insulation Victoria", "Rapid Insulation"]);
    expect(r?.source).toBe("website");
  });
  test("no withdrawal, no rows", () => {
    expect(contactConsentRecord([{ consented_at: "2026-11-02T01:00:00Z", snapshot: s, source: "website" }], [])?.withdrawnAt).toBeNull();
    expect(contactConsentRecord([], [])).toBeNull();
  });
  test("old snapshot without who stays readable", () => {
    const r = contactConsentRecord([{ consented_at: "2026-08-03T01:00:00Z", snapshot: { contact_consent: true }, source: "base44" }], []);
    expect(r?.who).toEqual(["Home Insulation Victoria"]);
    expect(r?.expiresAt?.slice(0, 10)).toBe("2026-11-03");
  });
  test("website wording verbatim", () => {
    expect(WEBSITE_CONSENT_WORDING).toBe("I agree to Home Insulation Victoria and the EEC-certified installer it picks for me contacting me about my ceiling insulation.");
    expect(WEBSITE_CONSENT_LIVE_FROM_ISO).toBeNull();
  });
  test("website wording: constant only from cut-off", () => {
    expect(websiteConsentWording("2026-12-01T00:00:00Z", "old", null)).toBe("old");
    expect(websiteConsentWording("2026-12-01T00:00:00Z", "old", "2026-12-01T00:00:00Z")).toBe(WEBSITE_CONSENT_WORDING);
    expect(websiteConsentWording("2026-11-30T00:00:00Z", "old", "2026-12-01T00:00:00Z")).toBe("old");
    expect(websiteConsentWording("2026-11-30T00:00:00Z", null, "2026-12-01T00:00:00Z")).toBe("");
  });
});

describe("planContactConsent snapshot", () => {
  test("granted website consent names Home Insulation Victoria and an end date", () => {
    const p = planContactConsent({ contact_consent: true, contact_consented_at: "2026-11-02T01:00:00Z" });
    expect(p.snapshot).toMatchObject({ who: ["Home Insulation Victoria"], methods: ["phone", "visit"] });
    expect((p.snapshot as { expiresAt: string }).expiresAt.slice(0, 10)).toBe("2027-02-02");
  });
  test("consent key unchanged by the new fields", () => {
    expect(planContactConsent({ contact_consent: true, contact_consented_at: "t" }).consent_key).toBe("granted|-|t|-|-|-");
  });
  test("missing consent gets no end date", () => {
    expect((planContactConsent({}).snapshot as Record<string, unknown>)["expiresAt"]).toBeUndefined();
  });
});
