import { describe, expect, it } from "vitest";
import {
  INTEREST_CONSENT_VERSION,
  parseInterest,
  tidyMobile,
  tidyName,
  type InterestDraft,
} from "../src/lib/interest.core";

const base: InterestDraft = {
  fullName: "joannah lowe",
  mobile: "0400 123 456",
  email: " Jo@Example.com ",
  addressLine: "12 Test Street",
  suburb: "Footscray",
  postcode: "3011",
  ceilingM2: 150,
  insulationDeclared: "unknown",
  consent: true,
  honeypot: "",
};

describe("tidyName", () => {
  it("capitalises each word and collapses spacing", () => {
    expect(tidyName("  john   SMITH ")).toBe("John SMITH");
    expect(tidyName("mary-jane o'brien")).toBe("Mary-Jane O'Brien");
  });
});

describe("tidyMobile", () => {
  it("converts common AU formats to +61", () => {
    expect(tidyMobile("0400 123 456")).toBe("+61400123456");
    expect(tidyMobile("(03) 9999 1111")).toBe("+61399991111");
    expect(tidyMobile("+61 400 123 456")).toBe("+61400123456");
    expect(tidyMobile("0400")).toBeNull();
    expect(tidyMobile("abc")).toBeNull();
  });
});

describe("parseInterest", () => {
  it("returns a cleaned record with consent version", () => {
    const result = parseInterest(base);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        fullName: "Joannah Lowe",
        mobile: "+61400123456",
        email: "jo@example.com",
        addressLine: "12 Test Street",
        suburb: "Footscray",
        postcode: "3011",
        ceilingM2: 150,
        insulationDeclared: "unknown",
        consentVersion: INTEREST_CONSENT_VERSION,
      });
    }
  });

  it("refuses without consent and explains why", () => {
    const result = parseInterest({ ...base, consent: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.consent).toContain("tick");
  });

  it("requires a 4-digit postcode", () => {
    const result = parseInterest({ ...base, postcode: "301" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.postcode).toContain("4-digit");
  });

  it("refuses a filled honeypot without storing it", () => {
    const result = parseInterest({ ...base, honeypot: "buy-cheap-insurance" });
    expect(result.ok).toBe(false);
  });

  it("accepts a lead with just name, mobile and email (no address, no size)", () => {
    const result = parseInterest({ ...base, addressLine: "", suburb: "", ceilingM2: 0 });
    expect(result.ok).toBe(true);
  });

  it("rejects ceiling sizes outside the calculator range", () => {
    expect(parseInterest({ ...base, ceilingM2: 5 }).ok).toBe(false);
    expect(parseInterest({ ...base, ceilingM2: 4000 }).ok).toBe(false);
  });

  it("rejects a bad email and a bad mobile", () => {
    const badEmail = parseInterest({ ...base, email: "not-an-email" });
    expect(badEmail.ok).toBe(false);
    const badMobile = parseInterest({ ...base, mobile: "12" });
    expect(badMobile.ok).toBe(false);
  });
});
