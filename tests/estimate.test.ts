import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { A48_SPEC, V25_LOCATIONS, ghgEquivalentReduction, lookupLocation } from "../src/lib/activity48.core";
import { CALC_NOTE, FEE_LABEL, benchmarkNote, parseAssumption, whatIfEstimate, computeEstimate, customerCanSee, displayModeFor, estimateSignature, pickArea, type RetailSettings } from "../src/lib/estimate.core";

const S: RetailSettings = {
  id: "s1", version: 1, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349,
  access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25, indicative_veec_value: 70,
  veec_value_source_label: "DEECA webinar", veec_value_source_url: "https://www.energy.vic.gov.au/x", veec_value_checked_at: "2026-09-29",
  minimum_customer_copayment_inc_gst: 200, spec_version: "25.0", spec_source_url: A48_SPEC.sourceUrl,
};
const owner = (m2: number) => pickArea({ owner: m2 })!;

describe("VEU v25 Location Variable List", () => {
  test("full table extracted (719 postcodes, no ranges)", () => { expect(V25_LOCATIONS.size).toBe(719); });
  test.each([["3058", "Metropolitan", "Mild"], ["3300", "Regional", "Cold"], ["3490", "Regional", "Hot"], ["3980", "Metropolitan", "Cold"], ["3816", "Regional", "Mild"]])("%s = %s / %s", (p, m, c) => {
    const l = lookupLocation(p)!; expect(l.metropolitan_or_regional).toBe(m as never); expect(l.climate_region).toBe(c as never); expect(l.source_version).toBe("25.0");
  });
  test("unlisted postcode is null, not guessed", () => { expect(lookupLocation("3005")).toBeNull(); expect(lookupLocation("abc")).toBeNull(); });
});

describe("Equation 48.1", () => {
  test("factors", () => { expect(A48_SPEC.lifetimeYears).toBe(25); expect(A48_SPEC.regionalFactor).toEqual({ Metropolitan: 0.98, Regional: 1.04 }); expect(A48_SPEC.ghgSavings).toEqual({ Mild: 0.00576, Cold: 0.00771, Hot: 0.00546 }); });
  test("regional cold / hot", () => {
    expect(ghgEquivalentReduction(100, lookupLocation("3300")!).ghgReduction).toBeCloseTo(0.00771 * 100 * 25 * 1.04, 10);
    expect(ghgEquivalentReduction(100, lookupLocation("3490")!).ghgReduction).toBeCloseTo(0.00546 * 100 * 25 * 1.04, 10);
  });
});

describe("3058 / 134.1 m² sample", () => {
  const ghg = 0.00576 * 134.1 * 25 * 0.98, disc = ghg * 70;
  const none = computeEstimate(owner(134.1), lookupLocation("3058")!, "none", S);
  const pres = computeEstimate(owner(134.1), lookupLocation("3058")!, "present", S);
  test("GHG + discount unrounded", () => { expect(none.ghg.ghgReduction).toBeCloseTo(ghg, 12); expect(none.raw_estimated_discount).toBeCloseTo(disc, 10); });
  test("no-removal standard total", () => {
    const t = none.primary.by_access.standard;
    expect(t.pre_discount_total).toBeCloseTo(134.1 * 30 + 698, 2);
    expect(t.estimated_customer_total).toBeCloseTo(134.1 * 30 + 698 - disc, 2);
    expect(none.scenarios.length).toBe(1);
  });
  test("full removal adds area × $15 before discount", () => {
    expect(pres.scenarios.map((s) => s.key)).toEqual(["can_remain", "full_removal"]);
    expect(pres.scenarios[1]!.by_access.standard.pre_discount_total - pres.scenarios[0]!.by_access.standard.pre_discount_total).toBeCloseTo(134.1 * 15, 2);
  });
  test("access loads install component only", () => {
    expect(none.access_adjustment.moderate).toBeCloseTo(134.1 * 30 * 0.1, 2);
    expect(none.access_adjustment.difficult).toBeCloseTo(134.1 * 30 * 0.25, 2);
    const fr = pres.scenarios[1]!.by_access;
    expect(fr.difficult.pre_discount_total - fr.standard.pre_discount_total).toBeCloseTo(134.1 * 30 * 0.25, 2);
  });
  test("unknown insulation => two scenarios", () => { expect(computeEstimate(owner(134.1), lookupLocation("3058")!, "unknown", S).scenarios.length).toBe(2); });
});

describe("guards", () => {
  test("$200 minimum co-payment caps discount", () => {
    const e = computeEstimate(owner(10), lookupLocation("3300")!, "none", { ...S, indicative_veec_value: 10000 });
    const t = e.primary.by_access.standard;
    expect(t.estimated_customer_total).toBeCloseTo(200, 2); expect(t.copayment_capped).toBe(true);
  });
  test("missing area => no estimate", () => { expect(pickArea({ owner: null })).toBeNull(); expect(pickArea({ owner: 0 })).toBeNull(); });
  test("area hierarchy", () => {
    expect(pickArea({ measurement: { id: "m", m2: 120 }, estimate: { id: "e", m2: 140, tier: "B" }, owner: 150 })!.source).toBe("accepted_measurement");
    expect(pickArea({ estimate: { id: "e", m2: 140, tier: "B" }, owner: 150 })!.source).toBe("area_estimate");
    expect(pickArea({ owner: 150 })!.basis).toBe("declared");
  });
  test("display modes", () => {
    expect(displayModeFor({ outcome: "likely_eligible", reviewRequired: false, recorded: true })).toBe("likely");
    expect(displayModeFor({ outcome: "needs_onsite_confirmation", reviewRequired: false, recorded: true })).toBe("onsite");
    expect(displayModeFor({ outcome: null, reviewRequired: true, recorded: true })).toBe("withheld_review");
    expect(displayModeFor({ outcome: "likely_eligible", reviewRequired: true, recorded: true })).toBe("withheld_review");
    expect(displayModeFor({ outcome: "does_not_appear_eligible", reviewRequired: false, recorded: true })).toBe("none_ineligible");
    expect(displayModeFor({ outcome: "needs_onsite_confirmation", reviewRequired: false, recorded: false })).toBe("withheld_undecided");
    expect(customerCanSee("withheld_review")).toBe(false); expect(customerCanSee("none_ineligible")).toBe(false);
  });
  test("idempotent signature; changes on material inputs", () => {
    const base = { mode: "likely" as const, area: owner(134.1), postcode: "3058", insulation: "none" as const, settingsId: "s1", settingsVersion: 1, veecValue: 70, veecSource: "u|2026-09-29", specVersion: "25.0" };
    expect(estimateSignature(base)).toBe(estimateSignature({ ...base, area: owner(134.1) }));
    for (const ch of [{ area: owner(140) }, { postcode: "3300" }, { insulation: "present" as const }, { mode: "onsite" as const }, { settingsVersion: 2 }, { veecValue: 86 }, { veecSource: "u|2026-10-01" }])
      expect(estimateSignature({ ...base, ...ch })).not.toBe(estimateSignature(base));
  });
});

describe("static separation / UI", () => {
  const code = (f: string) => readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const core = code("src/lib/estimate.core.ts") + code("src/lib/estimate.server.ts") + code("src/lib/activity48.core.ts");
  test("Step 3 never uses legacy per-m² VEEC credit, pricing_settings, supplier rates or external systems", () => {
    for (const bad of ["veec_credit_per_m2", "pricing_settings", "rate_card", "ap_margin", "xero", "mitti", "sendMessage", "assertCustomerCommsEnabled", "stripe", "booking.server"]) expect(core.toLowerCase()).not.toContain(bad.toLowerCase());
  });
  test("legacy final-quote flat credit is marked", () => { expect(readFileSync("src/lib/quotes.server.ts", "utf8")).toContain("LEGACY: flat per-m² VEEC credit"); });
  const ui = readFileSync("src/components/portal/estimate.tsx", "utf8");
  test("customer copy", () => {
    for (const t of ["Your home looks suitable to progress", "Your home may be eligible — onsite confirmation needed", "R5.0 insulation supply &amp; installation", "Estimated VEU discount", "Estimated price after VEU discount", "Onsite Measure + PIESA", "already included", "Access is confirmed onsite"]) expect(ui).toContain(t);
    expect(ui).not.toMatch(/<Button|Pay now|pay\(|createBooking|useServerFn\(create/i);
    expect(ui).toContain("{FEE_LABEL}");
    expect(ui).not.toContain("AP management &amp; compliance");
    expect(ui).toContain("Step 3 · Indicative estimate");
  });
  test("owner page shows card; admin tab places it after Gate 1", () => {
    expect(readFileSync("src/routes/_authenticated/owner.$jobId.tsx", "utf8")).toContain("<OwnerEstimateCard");
    expect(readFileSync("src/routes/_authenticated/admin.jobs.$jobId.tsx", "utf8")).toContain("<Gate1EvidencePanel jobId={jobId} /><AdminEstimateCard");
  });
  test("customer projection excludes audit internals", () => {
    const srv = readFileSync("src/lib/estimate.server.ts", "utf8");
    const cv = srv.slice(srv.indexOf("export function customerView"));
    expect(cv).not.toContain("snapshot"); expect(cv).not.toContain("raw_estimated_discount");
  });
});

describe("Step 3 v2 refinement", () => {
  test("HV-1051 exact v2 numbers", () => {
    const e = computeEstimate(owner(134.1), lookupLocation("3058")!, "present", S);
    expect(e.ghg.ghgReduction).toBeCloseTo(18.924192, 9);
    expect(e.raw_estimated_discount).toBeCloseTo(1324.69344, 8);
    const [cr, fr] = e.scenarios;
    expect(cr!.by_access.standard.pre_discount_total).toBeCloseTo(4721, 2);
    expect(cr!.by_access.standard.estimated_customer_total).toBeCloseTo(3396.31, 2);
    expect(fr!.by_access.standard.pre_discount_total).toBeCloseTo(6732.5, 2);
    expect(fr!.by_access.standard.estimated_customer_total).toBeCloseTo(5407.81, 2);
    expect(e.access_adjustment).toEqual({ moderate: 402.3, difficult: 1005.75 });
  });
  test("wording: benchmark not market price; fee not government-mandated", () => {
    const n = benchmarkNote(70);
    expect(n).toContain("$70 per VEEC-equivalent benchmark"); expect(n).toContain("not the live VEEC market price"); expect(n).not.toMatch(/official (fixed )?VEEC price|guarantee/i);
    expect(FEE_LABEL).toBe("HI VIC compliance & administration");
    const core = readFileSync("src/lib/estimate.core.ts", "utf8"); expect(core).not.toMatch(/government[- ]mandated/i);
  });
  test("assumption validation", () => {
    for (const bad of ["", "abc", "0", "-5", "NaN", "19", "1001"]) expect(parseAssumption(bad)).toBeNull();
    expect(parseAssumption("150")).toBe(150); expect(parseAssumption(" 134.1 ")).toBe(134.1);
  });
  test("what-if uses same core; none single scenario, unknown two; no location => null", () => {
    const loc = lookupLocation("3058")!;
    expect(whatIfEstimate(150, loc, "none", S)!.scenarios.length).toBe(1);
    expect(whatIfEstimate(150, loc, "unknown", S)!.scenarios.length).toBe(2);
    expect(whatIfEstimate(150, loc, "present", S)!.primary.by_access.standard.estimated_customer_total).toBeCloseTo(computeEstimate(owner(150), loc, "present", S).primary.by_access.standard.estimated_customer_total, 6);
    expect(whatIfEstimate(null, loc, "none", S)).toBeNull();
    expect(whatIfEstimate(150, lookupLocation("3005"), "none", S)).toBeNull();
    // official consumer example: 150 m² metro/mild ≈ $1,482
    expect(whatIfEstimate(150, loc, "none", S)!.raw_estimated_discount).toBeCloseTo(1481.76, 2);
  });
  test("calculator is client-only and never persisted", () => {
    const ui = readFileSync("src/components/portal/estimate.tsx", "utf8");
    const calc = ui.slice(ui.indexOf("function AreaCalculator"), ui.indexOf("export function OwnerEstimateCard"));
    expect(calc).not.toMatch(/useServerFn|supabase|fetch\(|useMutation|useAction/);
    expect(calc).toContain("useState(initial == null ? \"\" : String(initial))"); // no silent 150 default
    expect(ui).toContain("CALC_NOTE"); expect(CALC_NOTE).toContain("does not change your recorded property details");
    const srv = readFileSync("src/lib/estimate.server.ts", "utf8");
    expect(srv).not.toMatch(/from\("(jobs|ceiling_measurements|property_area_estimates)"\)\.(update|insert|upsert)/);
    expect(srv).not.toMatch(/assumption/i);
  });
});
