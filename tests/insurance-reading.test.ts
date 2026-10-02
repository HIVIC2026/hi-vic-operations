import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { acceptedPatch, compareReading, normaliseExtract, parseAmount, parseAuDate } from "../src/lib/insurance-reading.core";

describe("reading certificate values", () => {
  test("Australian dates are day/month/year, never US order", () => {
    expect(parseAuDate("30/06/2027")).toBe("2027-06-30");
    expect(parseAuDate("04/05/2027")).toBe("2027-05-04");
    expect(parseAuDate("4:00pm 30/06/2027")).toBe("2027-06-30");
    expect(parseAuDate("30 June 2027")).toBe("2027-06-30");
    expect(parseAuDate("1st Sept 2027")).toBe("2027-09-01");
    expect(parseAuDate("2027-06-30")).toBe("2027-06-30");
    expect(parseAuDate("31/02/2027")).toBeNull();
    expect(parseAuDate("06/30/2027")).toBeNull();
    expect(parseAuDate("soon")).toBeNull();
  });
  test("cover amounts as printed", () => {
    expect(parseAmount("$20,000,000")).toBe(20_000_000);
    expect(parseAmount("AUD 10,000,000")).toBe(10_000_000);
    expect(parseAmount("$20 million")).toBe(20_000_000);
    expect(parseAmount("20m")).toBe(20_000_000);
    expect(parseAmount(5_000_000)).toBe(5_000_000);
    expect(parseAmount("$20,000,000 any one occurrence")).toBeNull();
    expect(parseAmount("see schedule")).toBeNull();
    expect(parseAmount("$500")).toBeNull();
  });
  test("malformed or empty AI output gives nothing rather than a guess", () => {
    expect(normaliseExtract(null)).toBeNull();
    expect(normaliseExtract({ insurer: "N/A", policy_number: "", cover_amount: "unclear", expiry: "unknown" })).toBeNull();
    const x = normaliseExtract({ insured_name: "Sparky Pty Ltd", insurer: "  QBE  Insurance ", policy_number: "PL-123", cover_amount: "$20,000,000", expiry: "30/06/2027", is_public_liability: true })!;
    expect(x).toEqual({ insured_name: "Sparky Pty Ltd", insurer: "QBE Insurance", policy_number: "PL-123", cover_amount: 20_000_000, expiry: "2027-06-30", is_public_liability: true });
  });
});

describe("typed details stay authoritative", () => {
  const x = normaliseExtract({ insurer: "QBE Insurance", policy_number: "PL-123", cover_amount: "$20,000,000", expiry: null })!;
  test("valid: empty fields are offered, nothing applied until accepted", () => {
    const rows = compareReading({}, x);
    expect(rows.map((r) => r.status)).toEqual(["fill", "fill", "fill", "unread"]);
    expect(acceptedPatch(rows, [])).toEqual({});
    expect(acceptedPatch(rows, ["insurer"])).toEqual({ insurer: "QBE Insurance" });
  });
  test("conflicting: typed value kept unless explicitly replaced", () => {
    const rows = compareReading({ insurer: "Allianz", insurance_policy_number: "pl-123", public_liability_cover_amount: 10_000_000 }, x);
    expect(rows[0]!.status).toBe("conflict");
    expect(rows[1]!.status).toBe("same");
    expect(rows[2]!.status).toBe("conflict");
    expect(acceptedPatch(rows, ["public_liability_cover_amount"])).toEqual({ public_liability_cover_amount: 20_000_000 });
  });
  test("missing: nothing read means nothing offered", () => {
    const rows = compareReading({ insurer: "Allianz" }, null);
    expect(rows.every((r) => r.status === "unread")).toBe(true);
    expect(acceptedPatch(rows, ["insurer", "public_liability_expiry"])).toEqual({});
  });
  test("both forms no longer auto-fill read values", () => {
    for (const f of ["src/routes/electrician-onboarding.tsx", "src/routes/installer-onboarding.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toContain("patch.insurer = x.insurer");
      expect(src).not.toContain("patch.public_liability_cover_amount = x.cover_amount");
      expect(src).toContain("<InsuranceReadReview");
    }
  });
});

describe("address suggestions close after a pick", () => {
  for (const f of ["src/routes/electrician-onboarding.tsx", "src/routes/installer-onboarding.tsx"]) {
    test(f, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/aria-live="polite"[^>]*>\{announce\}/);
      expect(src).toContain('e.key === "Escape" && open');
      expect(src).toContain('role="combobox"');
    });
  }
});
