import { describe, expect, test, mock } from "bun:test";
import { readFileSync } from "fs";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const { enquirySchema } = await import("../src/lib/enquiry.server");
const base = { external_enquiry_id: "b44-area", full_name: "A", email: "a@b.co", address_line: "1 Test St" };
const ok = (v: unknown) => enquirySchema.safeParse({ ...base, ...(v as object) }).success;

describe("LOCKED intake invariant: numeric ceiling area estimate", () => {
  test.each([100, 125, 150, 200, 87.5, 5000])("%p m² passes", (a) => expect(ok({ estimated_area_m2: a })).toBe(true));
  test("missing fails", () => expect(ok({})).toBe(false));
  test("null fails", () => expect(ok({ estimated_area_m2: null })).toBe(false));
  test("blank/NaN/string fail", () => { for (const a of ["", "150", NaN, Infinity]) expect(ok({ estimated_area_m2: a })).toBe(false); });
  test("zero/negative fail", () => { expect(ok({ estimated_area_m2: 0 })).toBe(false); expect(ok({ estimated_area_m2: -10 })).toBe(false); });
  test(">5000 fails", () => expect(ok({ estimated_area_m2: 5000.1 })).toBe(false));
  test("area_unknown:true fails even with an area", () => { expect(ok({ area_unknown: true })).toBe(false); expect(ok({ estimated_area_m2: 150, area_unknown: true })).toBe(false); });
  test("area_unknown:false still accepted for compatibility", () => expect(ok({ estimated_area_m2: 150, area_unknown: false })).toBe(true));
  test("referral enquiry missing area fails", () => expect(ok({ referral_token: "rt_abc" })).toBe(false));
  test("persistence always writes estimated_area_unknown=false", () => {
    const src = readFileSync("src/lib/enquiry.server.ts", "utf8");
    expect(src).toContain("estimated_area_m2: input.estimated_area_m2,");
    expect(src).toContain("estimated_area_unknown: false,");
    expect(src).not.toContain("input.area_unknown ?");
  });
});
