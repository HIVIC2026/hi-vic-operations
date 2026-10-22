import { describe, expect, test, mock } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
const { enquirySchema, intakeJobFacts } = await import("../src/lib/enquiry.server");
const base = { external_enquiry_id: "b44-area", full_name: "A", email: "a@b.co", address_line: "1 Test St" };
const ok = (v: unknown) => enquirySchema.safeParse({ ...base, ...(v as object) }).success;
const hivic = { channel: "hivic_sourced" } as never;
const facts = (input: Parameters<typeof intakeJobFacts>[0], source = "base44") => intakeJobFacts(input, source, hivic);

describe("LOCKED intake invariant: numeric ceiling area estimate", () => {
  test.each([100, 125, 150, 200, 87.5, 5000])("%p m² passes", (a) => expect(ok({ estimated_area_m2: a })).toBe(true));
  test("missing fails", () => expect(ok({})).toBe(false));
  test("blank/NaN/string fail", () => { for (const a of ["", "150", NaN, Infinity]) expect(ok({ estimated_area_m2: a })).toBe(false); });
  test("zero/negative fail", () => { expect(ok({ estimated_area_m2: 0 })).toBe(false); expect(ok({ estimated_area_m2: -10 })).toBe(false); });
  test(">5000 fails", () => { expect(ok({ estimated_area_m2: 5000.1 })).toBe(false); });
  test("referral enquiry missing area fails", () => expect(ok({ referral_token: "rt_abc" })).toBe(false));
  test("schema accepts explicit null only as an explicit value (manual form), rejects missing", () => {
    expect(ok({ estimated_area_m2: null })).toBe(true);
    expect(ok({})).toBe(false);
  });
});

describe("LOCKED intake invariant: per-source guard in intakeJobFacts", () => {
  test("base44 signed intake: null area fails", () => expect(() => facts({ estimated_area_m2: null })).toThrow());
  test("base44 signed intake: area_unknown:true fails even with an area", () => {
    expect(() => facts({ estimated_area_m2: null, area_unknown: true })).toThrow();
    expect(() => facts({ estimated_area_m2: 150, area_unknown: true })).toThrow();
  });
  test("base44 signed intake: area_unknown:false still accepted for compatibility", () => {
    expect(facts({ estimated_area_m2: 150, area_unknown: false }).estimated_area_unknown).toBe(false);
  });
  test("base44 signed intake always persists estimated_area_unknown=false", () => {
    expect(facts({ estimated_area_m2: 150 }).estimated_area_unknown).toBe(false);
  });
  test("manual portal intake may record unknown area (null + flag) without a made-up figure", () => {
    const f = facts({ estimated_area_m2: null, area_unknown: true }, "portal");
    expect(f.estimated_area_m2).toBeNull();
    expect(f.estimated_area_unknown).toBe(true);
  });
  test("manual portal intake with an area still persists area_unknown=false", () => {
    expect(facts({ estimated_area_m2: 100 }, "portal").estimated_area_unknown).toBe(false);
  });
});
