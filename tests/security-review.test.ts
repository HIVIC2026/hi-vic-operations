import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { partnerAllowedForJob, TEST_PARTNER_MARK } from "../src/lib/test-send.core";

describe("1. TEST accounts", () => {
  test("no password literal in code", () => {
    const src = readFileSync("src/lib/test-accounts.functions.ts", "utf8");
    expect(src).not.toMatch(/password:\s*["'`][^"'`$]/);
    expect(src).not.toContain("Hivic-Test-Only");
  });
  test("real jobs never reach TEST partners; TEST jobs only reach TEST partners", () => {
    const t = { onboarding_notes: `${TEST_PARTNER_MARK} x` }, r = { onboarding_notes: null };
    expect(partnerAllowedForJob(t, "base44")).toBe(false);
    expect(partnerAllowedForJob(r, "base44")).toBe(true);
    expect(partnerAllowedForJob(t, "qa_test")).toBe(true);
    expect(partnerAllowedForJob(r, "qa_test")).toBe(false);
  });
});

describe("2. Bulk import owners", () => {
  test("exact email match escapes wildcards", async () => {
    const { exactLike } = await import("../src/lib/email-match");
    expect(exactLike("a_b%c@x.com")).toBe("a\\_b\\%c@x.com");
  });
});

describe("4. Bulk import permission", () => {
  test("every member check requires the business boss", () => {
    const src = readFileSync("src/lib/bulk-import.functions.ts", "utf8");
    const calls = [...src.matchAll(/requireMember\(([^)]*)\)/g)].map((m) => m[1]!);
    expect(calls.length).toBe(3);
    for (const c of calls) expect(c.trim().endsWith("true")).toBe(true);
  });
});

describe("5–6. Prices and discount from settings, one discount path", () => {
  test("no hard-coded PIESA constant or legacy per-m² credit in code", () => {
    for (const f of ["src/lib/installer-led.core.ts", "src/lib/installer-quote.server.ts", "src/lib/quotes.server.ts"]) {
      const s = readFileSync(f, "utf8");
      expect(s).not.toContain("HIVIC_PIESA_INC_GST");
      expect(s).not.toMatch(/export function priceInstallerOption/);
      expect(s).not.toMatch(/maxMetro|maxRegional/);
    }
    expect(readFileSync("src/lib/profit.core.ts", "utf8")).not.toMatch(/veecDiscountIncGst \/ OWNER_VEEC_RATE/);
  });
  test("quote internals honour the job AP fee override", () => {
    expect(readFileSync("src/lib/quotes.server.ts", "utf8")).toContain("ap_fee_ex_gst: r2((jobRow.ap_fee_override_inc_gst != null");
  });
  test("PIESA charge follows the settings price", async () => {
    const { piesaChargeIncGst } = await import("../src/lib/installer-led.core");
    expect(piesaChargeIncGst("hivic_matched", 299)).toBe(299);
    expect(piesaChargeIncGst("hivic_matched", null)).toBeNull();
  });
});
