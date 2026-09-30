import { describe, expect, test, mock } from "bun:test";
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: {} }));
import { evaluateGate1, resolveGate1Facts, type StoredProperty } from "../src/lib/eligibility.core";
import { buildBase44Evidence } from "../src/lib/enquiry.core";
import { lookupLocation } from "../src/lib/activity48.core";
import { whatIfEstimate } from "../src/lib/estimate.core";
import { acceptSelectedAddress, resolveWhatIfLocation } from "../src/lib/whatif-location";
import { computeElectricalAllowance, measuredQuote, reconcilePiesa, checkPiesaWindow, testPaymentTransition, TEST_REC_RATE_CARD, READY_CHECK_PAID_STAGE } from "../src/lib/readycheck.core";
import { measuredCustomerRows } from "../src/lib/customer-quote-system";
const { enquirySchema } = await import("../src/lib/enquiry.server");

const research = { status: "complete", state: "vic", postcode: "3336", formatted_address: "30 Dash St, Fraser Rise VIC 3336", premises_classification: "Residential dwelling", first_appearance_year: 2001, age_evidence_source: "historical imagery" };
const gate1 = (insulation: string, prev: "yes" | "no") => {
  const b = buildBase44Evidence({ declared_property_type: "house", declared_over_five_years: "yes", declared_previous_upgrade: prev, property_research: research });
  const p = { state: "VIC", postcode: "3336", occupancy: "owner_occupied", is_residential: null, year_built: null, enrichment: { base44: { ...b, raw: { answers: { insulation } } } } } as unknown as StoredProperty;
  return evaluateGate1(resolveGate1Facts(p, { lifeSupportStatus: "no", preliminaryOutcome: null }, 5, 2026));
};
const settings = { id: "t", version: 2, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25, indicative_veec_value: 70, minimum_customer_copayment_inc_gst: 200 } as never;
const home = lookupLocation("3336")!;
const disc = (m2: number, loc = home) => whatIfEstimate(m2, loc, "none" as never, settings)!.scenarios[0]!.by_access.standard;
const enquiry = { external_enquiry_id: "dummy-1", full_name: "Alex Test", email: "qa@example.com", address_line: "30 Dash St", suburb: "Fraser Rise", postcode: "3336", occupancy: "owner_occupied" };

describe("dummy journey 1-17 (fixtures only)", () => {
  test("1 likely: no insulation, no previous upgrade", () => expect(gate1("none", "no").outcome).toBe("likely_eligible"));
  test("2 onsite: existing insulation present", () => { const d = gate1("present", "no"); expect(d.outcome).toBe("needs_onsite_confirmation"); expect(d.onsite.length).toBeGreaterThan(0); });
  test("3 previous upgrade yes → does_not_appear_eligible (hard preliminary fail)", () => { const d = gate1("none", "yes"); expect(d.outcome).toBe("does_not_appear_eligible"); });
  test("4 missing area rejected", () => { for (const v of [undefined, null, "", NaN]) expect(enquirySchema.safeParse({ ...enquiry, estimated_area_m2: v }).success).toBe(false); expect(enquirySchema.safeParse({ ...enquiry, estimated_area_m2: 150, area_unknown: true }).success).toBe(false); });
  test("5 custom 173.5 accepted and used", () => { expect(enquirySchema.safeParse({ ...enquiry, estimated_area_m2: 173.5 }).success).toBe(true); expect(disc(173.5).estimated_customer_total).toBeGreaterThan(disc(150).estimated_customer_total); });
  test("6 same location baseline", () => { expect(disc(150).applied_discount).toBeCloseTo(1481.76, 2); expect(disc(150).estimated_customer_total).toBeCloseTo(3716.24, 2); });
  test("7 other VIC location changes discount at 150", () => { const a = acceptSelectedAddress({ label: "12 Main Rd, Ballarat East VIC 3350", postcode: "3350", state: "VIC" }); const r = a.ok ? resolveWhatIfLocation(home, a.address) : null; expect(r?.status).toBe("alternate"); if (r?.status === "alternate") expect(disc(150, r.location).applied_discount).not.toBeCloseTo(1481.76, 0); });
  test("8 edit invalidates → back to enquiry location", () => expect(resolveWhatIfLocation(home, null).status).toBe("original"));
  test("10/11 $99 test payment: failure no progress, retry succeeds, paid terminal", () => {
    expect(testPaymentTransition("pending" as never, "failure" as never)).toBe("failed");
    expect(testPaymentTransition("failed" as never, "success" as never)).toBe("paid");
    expect(testPaymentTransition("paid" as never, "failure" as never)).toBe("paid");
    expect(READY_CHECK_PAID_STAGE).toBe("ready_check_ready_to_schedule");
  });
  const obs = { "elec.downlight_type": "halogen", "elec.downlight_count": 8, "elec.rcd_visible": "not_visible" } as never;
  const a = computeElectricalAllowance(obs, TEST_REC_RATE_CARD, 1);
  test("12 measured 162m² + removal + access + allowance, $99 credited once", () => {
    const q = measuredQuote({ insulation: 162 * 30, removal: 162 * 15, access: 250, allowance: a, piesa: 349, ap: 349, discount: 1600, readyCheckPaid: true });
    expect(q.gross).toBe(4860 + 2430 + 250 + a.preliminary_electrical_allowance_total + 698);
    expect(q.costAfter).toBe(Math.round((q.gross - 1600 - 99) * 100) / 100);
    expect(q.rows.filter((r) => r.kind === "credit")).toHaveLength(1);
    const rows = measuredCustomerRows({ piesa: 349, installation: 4860, removal: 2430, access: 250, allowance: a.preliminary_electrical_allowance_total, apManagement: 349 }) as unknown as { label: string }[];
    const labels = JSON.stringify(rows);
    const order = ["PIESA", "R5.0", "removal", "Access", "Preliminary electrical", "Accredited Person"].map((k) => labels.indexOf(k));
    expect(order.every((v, i) => v >= 0 && (i === 0 || v > order[i - 1]!))).toBe(true);
  });
  test("13/14/15 PIESA same/lower/higher", () => {
    expect(reconcilePiesa([{ code: "DL_HALOGEN_REPLACE", quantity: 8 }, { code: "RCD_NOT_VISIBLE", quantity: 1 }], TEST_REC_RATE_CARD, a)).toMatchObject({ outcome: "same", requires_customer_approval: false });
    expect(reconcilePiesa([{ code: "DL_HALOGEN_REPLACE", quantity: 6 }], TEST_REC_RATE_CARD, a)).toMatchObject({ outcome: "lower", requires_customer_approval: false });
    expect(reconcilePiesa([{ code: "DL_HALOGEN_REPLACE", quantity: 8 }, { code: "RCD_NOT_VISIBLE", quantity: 1 }, { code: "SWB_CERAMIC", quantity: 1 }], TEST_REC_RATE_CARD, a)).toMatchObject({ outcome: "higher", requires_customer_approval: true });
  });
  test("16 no rectification → lower vs allowance, no approval", () => expect(reconcilePiesa([], TEST_REC_RATE_CARD, a)).toMatchObject({ actual_total: 0, requires_customer_approval: false }));
  test("17 30-day guard intact", () => {
    expect(checkPiesaWindow({ planned_piesa_date: null, planned_install_date: "2026-11-02", piesa_completed_at: "2026-10-01", today: "2026-10-05" }).hardWarning).toMatch(/new PIESA/);
    expect(checkPiesaWindow({ planned_piesa_date: null, planned_install_date: null, piesa_completed_at: "2026-10-01", today: "2026-11-05" }).newPiesaRequired).toBe(true);
  });
});
