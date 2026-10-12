// Jo 12 Oct 2026 — new pricing ($99 Ready Check, R5 $33/m² inc GST) with exact protection for saved spots.
// Pure rules + throwaway PGlite proof of the staged migration. No network, no live database, fake TEST data only.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { PricingCohortUnknownError, customerBreakdown, installRateLabel, mayReprice, protectedSavedTotals, readyCheckFeeLabel, resolveCustomerPricing, scopeDifference, type CohortSnapshot, type PricingRates } from "../src/lib/pricing-cohort.core";
import { readyCheckRemaining } from "../src/lib/readycheck.core";
import { applyReadyCheckFee, renderEstimateEmail, renderSaveSpotFromLikelyEmail } from "../src/lib/estimate-email";

const LEGACY: PricingRates = { settingsId: "l", settingsVersion: 2, r5InstallIncGstPerM2: 30, removalIncGstPerM2: 15, piesaIncGst: 349, apIncGst: 349, readyCheckFeeIncGst: 0 };
const NEW: PricingRates = { ...LEGACY, settingsId: "n", settingsVersion: 3, r5InstallIncGstPerM2: 33, readyCheckFeeIncGst: 99 };
const CUT = { cutoverAt: "2026-10-20T00:00:00Z", newSettings: NEW };
const SNAP: CohortSnapshot = { ...LEGACY, cohort: "legacy_saved_spot", spotSavedAt: "2026-10-05T01:00:00Z", savedTotal: 3698, savedGrossTotal: 5198, savedVeuDiscount: 1500, savedAreaM2: 150 };

describe("cohort resolution", () => {
  test("before cutover everyone keeps legacy rates and a free Ready Check", () => {
    const p = resolveCustomerPricing({ spotSavedAt: null, snapshot: null }, { ...LEGACY, readyCheckFeeIncGst: 99 }, null);
    expect(p.r5InstallIncGstPerM2).toBe(30); expect(p.readyCheckFeeIncGst).toBe(0);
  });
  test("saved spot with snapshot keeps $30/m² and free Ready Check after cutover", () => {
    const p = resolveCustomerPricing({ spotSavedAt: SNAP.spotSavedAt, snapshot: SNAP }, LEGACY, CUT);
    expect(p.cohort).toBe("legacy_saved_spot"); expect(p.r5InstallIncGstPerM2).toBe(30); expect(p.readyCheckFeeIncGst).toBe(0); expect(p.savedTotalsAuthoritative).toBe(true);
  });
  test("new enquiry after cutover gets $33/m² and $99", () => {
    const p = resolveCustomerPricing({ spotSavedAt: null, snapshot: null }, LEGACY, CUT);
    expect(p.r5InstallIncGstPerM2).toBe(33); expect(p.readyCheckFeeIncGst).toBe(0);
  });
  test("saved spot without a snapshot fails closed", () => {
    expect(() => resolveCustomerPricing({ spotSavedAt: "2026-10-05T01:00:00Z", snapshot: null }, LEGACY, CUT)).toThrow(PricingCohortUnknownError);
  });
  test("unreadable facts fail closed", () => {
    expect(() => resolveCustomerPricing({ spotSavedAt: undefined, snapshot: undefined }, LEGACY, CUT)).toThrow(PricingCohortUnknownError);
    expect(() => resolveCustomerPricing(null, LEGACY, CUT)).toThrow(PricingCohortUnknownError);
  });
});

describe("breakdown arithmetic", () => {
  test("new cohort 150 m² assumption: installation 4950 + PIESA + AP + 99 once", () => {
    const b = customerBreakdown(NEW, 150, 0, 1500);
    expect(b.installation).toBe(4950); expect(b.gross).toBe(4950 + 349 + 349 + 99); expect(b.total).toBe(b.gross - 1500);
    expect(b.payableNow).toBe(99); expect(b.remaining).toBe(b.total - 99);
  });
  test("removal $15/m² only on the area needing removal", () => {
    const b = customerBreakdown(NEW, 150, 40, 1500);
    expect(b.removal).toBe(600); expect(b.gross).toBe(4950 + 600 + 349 + 349 + 99);
  });
  test("legacy cohort breakdown has no Ready Check fee", () => {
    const b = customerBreakdown(LEGACY, 150, 0, 1500);
    expect(b.readyCheck).toBe(0); expect(b.gross).toBe(4500 + 698); expect(b.remaining).toBe(b.total);
  });
  test("Ready Check fee is subtracted from the remaining balance exactly once", () => {
    expect(readyCheckRemaining(4247, 99)).toBe(4148); expect(readyCheckRemaining(4247)).toBe(4247);
  });
  test("labels", () => {
    expect(readyCheckFeeLabel(NEW)).toBe("$99 including GST"); expect(readyCheckFeeLabel(LEGACY)).toBe("free");
    expect(installRateLabel({ r5InstallIncGstPerM2: 33, cohort: "current" })).toBe("$30 per m² plus GST ($33 per m² including GST)");
    expect(installRateLabel({ r5InstallIncGstPerM2: 30, cohort: "legacy_saved_spot" })).toBe("$30 per m² including GST");
  });
  test("protected saved totals are authoritative and area change is explicit at original rate", () => {
    expect(protectedSavedTotals(SNAP).total).toBe(3698);
    const d = scopeDifference(SNAP, 160);
    expect(d).toEqual({ changed: true, deltaM2: 10, deltaInstallIncGst: 300, needsApproval: true });
    expect(() => protectedSavedTotals({ ...SNAP, savedTotal: null })).toThrow(PricingCohortUnknownError);
  });
  test("issued/accepted quotes are never repriced", () => {
    expect(mayReprice("issued")).toBe(false); expect(mayReprice("accepted")).toBe(false); expect(mayReprice("draft")).toBe(true);
  });
});

const LINK = "https://estimate.homeinsulationvictoria.com.au/estimate/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const legacyInput = { estimateUrl: LINK, outcome: "likely" as const, firstName: "Test", estimatedTotal: 3698, veuDiscount: 1500, areaM2: 150, installationPrice: 4500, installationRatePerM2: 30, assessmentFee: 349, apFee: 349, grossProjectTotal: 5198, amountPayableNow: 0, estimatedRemainingBalance: 3698, apCount: 2 };
const newInput = { ...legacyInput, estimatedTotal: 4247, installationPrice: 4950, installationRatePerM2: 33, grossProjectTotal: 5747, amountPayableNow: 99, estimatedRemainingBalance: 4148, readyCheckFeeIncGst: 99, pricingCohort: "current" as const, areaIsTypical: true };

describe("emails", () => {
  test("legacy/protected email is byte-identical with or without explicit fee 0", () => {
    expect(renderEstimateEmail({ ...legacyInput, readyCheckFeeIncGst: 0 })).toEqual(renderEstimateEmail(legacyInput));
    expect(renderEstimateEmail(legacyInput).html).toContain(">FREE<");
  });
  test("new cohort email discloses $99 and the ex/inc GST rate, no free Ready Check left", () => {
    const m = renderEstimateEmail(newInput);
    expect(m.html).toContain("$99 including GST"); expect(m.html).toContain("$30 per m² plus GST ($33 per m² including GST)");
    expect(m.html).not.toMatch(/>FREE<|free measure-up/i); expect(m.plainText).not.toMatch(/: FREE\b/);
    expect(m.html).toContain("150 m²");
  });
  test("save-spot: legacy keeps free Ready Check; new says saving is free but check is $99", () => {
    const l = renderSaveSpotFromLikelyEmail({ ...legacyInput, campaignUrl: LINK + "/campaign" });
    expect(l.html).toContain("your free Ready Check");
    const n = renderSaveSpotFromLikelyEmail({ ...newInput, campaignUrl: LINK + "/campaign" });
    expect(n.html).toContain("Saving your spot is free and needs no payment.");
    expect(n.html).toContain("your Ready Check ($99 including GST)"); expect(n.html).toContain(LINK + "/campaign");
  });
  test("payable now must equal the cohort fee; gross must include it once", () => {
    expect(() => renderEstimateEmail({ ...newInput, amountPayableNow: 0, estimatedRemainingBalance: 4247 })).toThrow();
    expect(() => renderEstimateEmail({ ...newInput, grossProjectTotal: 5648, estimatedTotal: 4148 })).toThrow();
  });
  test("transform refuses to leave free wording in a paid email", () => {
    expect(() => applyReadyCheckFee({ subject: "x", previewText: "x", html: "Book your free measure-up now", plainText: "" }, { readyCheckFeeIncGst: 99 }, false)).toThrow();
  });
});

// ---------------- PGlite proof of the staged migration ----------------
const SQL = readFileSync(new URL("../docs/pending-migrations/0200_pricing_cohort_cutover.sql", import.meta.url), "utf8");
const UNDO = readFileSync(new URL("../docs/pending-migrations/0200_pricing_cohort_cutover.undo.sql", import.meta.url), "utf8");
const ACTOR = "00000000-0000-4000-8000-0000000000a1";
const FP = `SELECT md5(coalesce(string_agg(row_to_json(t)::text, '' ORDER BY job_id, spot_saved_at), '')) h FROM (SELECT job_id,spot_saved_at,saved_estimate_id,saved_total,saved_veu_discount,saved_gross_total,saved_area_m2,saved_insulation,saved_estimate_url FROM public.lead_campaign_responses WHERE spot_saved_at IS NOT NULL AND saved_total IS NOT NULL AND saved_gross_total IS NOT NULL AND saved_area_m2 IS NOT NULL ORDER BY job_id, spot_saved_at) t`;

async function freshDb() {
  const db = new PGlite();
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'select null::uuid';
CREATE TYPE public.app_role AS ENUM ('admin');
CREATE FUNCTION public.has_role(uuid, public.app_role) RETURNS boolean LANGUAGE sql AS 'select false';
CREATE TABLE public.retail_estimator_settings (id uuid primary key default gen_random_uuid(), version integer not null, is_current boolean not null default false,
  r5_install_inc_gst_per_m2 numeric(10,2) not null, removal_inc_gst_per_m2 numeric(10,2) not null, piesa_assessment_inc_gst numeric(10,2) not null, ap_management_inc_gst numeric(10,2) not null,
  access_standard_multiplier numeric default 1, access_moderate_multiplier numeric default 1.1, access_difficult_multiplier numeric default 1.25, indicative_veec_value numeric default 70,
  veec_value_source_label text, veec_value_source_url text, veec_value_checked_at date, minimum_customer_copayment_inc_gst numeric default 200, spec_version text, spec_source_url text,
  notes text, created_by uuid, veec_buy_price numeric default 70, max_discount_metro_inc_gst numeric default 1500, max_discount_regional_inc_gst numeric default 2100);
CREATE TABLE public.admin_config_events (id bigint generated always as identity primary key, actor_id uuid, event_type text, summary text, details jsonb);
CREATE TABLE public.lead_campaign_responses (id uuid primary key default gen_random_uuid(), job_id uuid not null, spot_saved_at timestamptz, saved_estimate_id uuid,
  saved_total numeric, saved_veu_discount numeric, saved_gross_total numeric, saved_area_m2 numeric, saved_insulation text, saved_estimate_url text);
INSERT INTO public.retail_estimator_settings (version, is_current, r5_install_inc_gst_per_m2, removal_inc_gst_per_m2, piesa_assessment_inc_gst, ap_management_inc_gst) VALUES (1,false,30,15,349,349),(2,true,30,15,349,349);
INSERT INTO public.lead_campaign_responses (job_id, spot_saved_at, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation, saved_estimate_url) VALUES
 ('00000000-0000-4000-8000-000000000001','2026-10-05T01:00:00Z',3698,1500,5198,150,'none','https://x/1'),
 ('00000000-0000-4000-8000-000000000002','2026-10-06T01:00:00Z',3998,1500,5498,160,'none','https://x/2'),
 ('00000000-0000-4000-8000-000000000003',null,null,null,null,null,null,null);`);
  return db;
}

describe("staged migration on PGlite", () => {
  test("Part A is inert: no prices change, saved fields untouched", async () => {
    const db = await freshDb(); const before = (await db.query<{ h: string }>(FP)).rows[0]!.h;
    await db.exec(SQL);
    const cur = (await db.query<any>(`SELECT * FROM public.retail_estimator_settings WHERE is_current`)).rows[0];
    expect(cur.r5_install_inc_gst_per_m2).toBe("30.00"); expect(cur.ready_check_fee_inc_gst).toBe("0.00");
    expect((await db.query<{ h: string }>(FP)).rows[0]!.h).toBe(before);
    expect((await db.query<any>(`SELECT count(*)::int n FROM public.job_pricing_cohorts`)).rows[0].n).toBe(0);
  });
  test("activation snapshots every saved spot, keeps legacy current, adds v3 at 33/99, leaves saved fields identical", async () => {
    const db = await freshDb(); await db.exec(SQL); const before = (await db.query<{ h: string }>(FP)).rows[0]!.h;
    await db.query(`SELECT public.activate_pricing_cutover($1, 'TEST cutover', $2)`, [ACTOR, before]);
    const rows = (await db.query<any>(`SELECT * FROM public.job_pricing_cohorts ORDER BY job_id`)).rows;
    expect(rows.length).toBe(2); expect(rows.every((r) => r.cohort === "legacy_saved_spot" && r.r5_install_inc_gst_per_m2 === "30.00" && r.ready_check_fee_inc_gst === "0.00")).toBe(true);
    expect(rows[0].saved_total).toBe("3698");
    const v = (await db.query<any>(`SELECT version, is_current, r5_install_inc_gst_per_m2 r5, ready_check_fee_inc_gst f FROM public.retail_estimator_settings ORDER BY version`)).rows;
    expect(v.map((x) => [x.version, x.is_current, x.r5, x.f])).toEqual([[1, false, "30.00", "0.00"], [2, true, "30.00", "0.00"], [3, false, "33.00", "0.00"]]);
    expect((await db.query<{ h: string }>(FP)).rows[0]!.h).toBe(before);
    expect((await db.query<any>(`SELECT count(*)::int n FROM public.saved_spot_price_backup`)).rows[0].n).toBe(2);
  });
  test("a save after cutover gets the new version at save time; earlier protected snapshot is immutable", async () => {
    const db = await freshDb(); await db.exec(SQL);
    await db.query(`SELECT public.activate_pricing_cutover($1, 'TEST cutover', null)`, [ACTOR]);
    await db.exec(`UPDATE public.lead_campaign_responses SET spot_saved_at = now(), saved_total = 4247, saved_gross_total = 5747, saved_veu_discount = 1500, saved_area_m2 = 150 WHERE job_id = '00000000-0000-4000-8000-000000000003'`);
    const r = (await db.query<any>(`SELECT cohort, r5_install_inc_gst_per_m2 r5, ready_check_fee_inc_gst f FROM public.job_pricing_cohorts WHERE job_id = '00000000-0000-4000-8000-000000000003'`)).rows[0];
    expect([r.cohort, r.r5, r.f]).toEqual(["current", "33.00", "0.00"]);
    await expect(db.exec(`UPDATE public.job_pricing_cohorts SET ready_check_fee_inc_gst = 99 WHERE job_id = '00000000-0000-4000-8000-000000000001'`)).rejects.toThrow(/permanent/);
  });
  test("race: fingerprint mismatch aborts the whole activation; double activation refused", async () => {
    const db = await freshDb(); await db.exec(SQL);
    await expect(db.query(`SELECT public.activate_pricing_cutover($1, 'TEST', 'stale')`, [ACTOR])).rejects.toThrow(/fingerprint/);
    expect((await db.query<any>(`SELECT count(*)::int n FROM public.retail_estimator_settings`)).rows[0].n).toBe(2);
    expect((await db.query<any>(`SELECT count(*)::int n FROM public.job_pricing_cohorts`)).rows[0].n).toBe(0);
    await db.query(`SELECT public.activate_pricing_cutover($1, 'TEST', null)`, [ACTOR]);
    await expect(db.query(`SELECT public.activate_pricing_cutover($1, 'TEST', null)`, [ACTOR])).rejects.toThrow(/already active/);
  });
  test("rollback stops the new version; history kept; undo of Part A refused after activation", async () => {
    const db = await freshDb(); await db.exec(SQL);
    await db.query(`SELECT public.activate_pricing_cutover($1, 'TEST', null)`, [ACTOR]);
    await db.query(`SELECT public.rollback_pricing_cutover($1, 'TEST rollback')`, [ACTOR]);
    expect((await db.query<any>(`SELECT count(*)::int n FROM public.pricing_cutover WHERE rolled_back_at IS NULL`)).rows[0].n).toBe(0);
    expect((await db.query<any>(`SELECT count(*)::int n FROM public.job_pricing_cohorts`)).rows[0].n).toBe(2);
    await expect(db.exec(UNDO)).rejects.toThrow(/rollback_pricing_cutover/);
  });
  test("undo of Part A before activation restores the original schema", async () => {
    const db = await freshDb(); await db.exec(SQL); await db.exec(UNDO);
    expect((await db.query<any>(`SELECT count(*)::int n FROM information_schema.columns WHERE column_name = 'ready_check_fee_inc_gst'`)).rows[0].n).toBe(0);
  });
});

// ---------------- Calculators (Jo 12 Oct 22:41) ----------------
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicCalculator } from "../src/components/portal/public-calculator";
import { REMOVAL_BUDGET_NOTE, calculatorTotals, publicCalculatorPricing, showRemovalBudgetNote, withReadyCheckFee } from "../src/lib/pricing-cohort.core";
import { whatIfEstimate, type RetailSettings } from "../src/lib/estimate.core";
import { lookupLocation } from "../src/lib/activity48.core";

const CALC: RetailSettings = { id: "t", version: 1, r5_install_inc_gst_per_m2: 30, removal_inc_gst_per_m2: 15, piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, access_standard_multiplier: 1, access_moderate_multiplier: 1.1, access_difficult_multiplier: 1.25, indicative_veec_value: 70, veec_value_source_label: "x", veec_value_source_url: "x", veec_value_checked_at: "2026-09-29", minimum_customer_copayment_inc_gst: 200, spec_version: "25.0", spec_source_url: "x" };
const html = (insulation: "none" | "present" | "unknown", fee: number, rate = 30, cohort: "pre_cutover" | "current" = "pre_cutover") =>
  renderToStaticMarkup(createElement(PublicCalculator, { settings: { ...CALC, r5_install_inc_gst_per_m2: rate }, initialValues: { address: "1 Test St, Richmond VIC 3121", areaM2: 150, insulation }, hideRegistration: true, readyCheckFeeIncGst: fee, pricingCohort: cohort }));

describe("calculators", () => {
  test("removal note shows exactly for 'Some there' and not for none", () => {
    expect(showRemovalBudgetNote("present")).toBe(true); expect(showRemovalBudgetNote("none")).toBe(false); expect(showRemovalBudgetNote("unknown")).toBe(false);
    const enc = (t: string) => t.replace(/’/g, "’");
    expect(html("present", 0)).toContain(enc(REMOVAL_BUDGET_NOTE));
    expect(html("none", 0)).not.toContain("removal-budget-note");
  });
  test("'Some there' never adds whole-ceiling removal to the calculator total", () => {
    const loc = lookupLocation("3121")!;
    const present = whatIfEstimate(150, loc, "present", CALC)!.scenarios[0]!.by_access.standard;
    const none = whatIfEstimate(150, loc, "none", CALC)!.scenarios[0]!.by_access.standard;
    expect(present.pre_discount_total).toBe(none.pre_discount_total);
  });
  test("itemised partial removal is added once at $15/m² of the removal area only", () => {
    const t = calculatorTotals({ pre_discount_total: 5198, estimated_customer_total: 3698, applied_discount: 1500 }, 99, 40 * 15);
    expect(t.gross).toBe(5198 + 99 + 600); expect(t.total).toBe(3698 + 99 + 600);
  });
  test("new-price calculator: $33/m², $99 once, ex/inc GST rate wording, no free Ready Check", () => {
    const h = html("unknown", 99, 33, "current");
    expect(h).toContain("$99 including GST"); expect(h).toContain("$30 per m² plus GST ($33 per m² including GST)");
    expect(h).not.toMatch(/free Ready Check|Ready Check — free/i);
    const loc = lookupLocation("3121")!;
    const st = whatIfEstimate(150, loc, "none", { ...CALC, r5_install_inc_gst_per_m2: 33 })!.scenarios[0]!.by_access.standard;
    const t = calculatorTotals(st, 99);
    expect(t.gross).toBe(4950 + 349 + 349 + 99);
    expect(h).toContain(`data-testid="public-calculator-final"`);
  });
  test("protected / pre-cutover calculator keeps $30/m² and free Ready Check", () => {
    const h = html("unknown", 0);
    expect(h).toContain("Ready Check — free"); expect(h).not.toContain("$99");
    expect(publicCalculatorPricing("legacy")).toEqual({ r5InstallIncGstPerM2: 30, readyCheckFeeIncGst: 0, cohort: "pre_cutover" });
    expect(publicCalculatorPricing("new")).toEqual({ r5InstallIncGstPerM2: 33, readyCheckFeeIncGst: 0, cohort: "current" });
  });
  test("saved price gets the fee once for new cohort and is unchanged for protected", () => {
    const p = { total: 3698, gross: 5198, discount: 1500 };
    expect(withReadyCheckFee(p, 0)).toBe(p);
    expect(withReadyCheckFee(p, 99)).toEqual({ total: 3797, gross: 5297, discount: 1500 });
  });
  test("re-choosing on an already-saved spot never overwrites saved fields (source guard)", () => {
    const src = readFileSync(new URL("../src/lib/launch-campaign.server.ts", import.meta.url), "utf8");
    expect(src).not.toContain(`update({ updated_at: now, ...snapshot })`);
    expect(src).toContain("pricingForJob(c.job.id)");
  });
});

describe("Ready Check stays free (Jo 12 Oct 23:12 UTC)", () => {
  test("a $99 settings row or snapshot still resolves to $0", () => {
    const cut = { cutoverAt: "2026-10-13T00:00:00Z", newSettings: { ...NEW, readyCheckFeeIncGst: 99 } };
    expect(resolveCustomerPricing({ spotSavedAt: null, snapshot: null }, LEGACY, cut).readyCheckFeeIncGst).toBe(0);
    expect(resolveCustomerPricing({ spotSavedAt: null, snapshot: null }, LEGACY, cut).r5InstallIncGstPerM2).toBe(33);
  });
  test("public calculator new pricing has $0 Ready Check", () => { expect(publicCalculatorPricing("new").readyCheckFeeIncGst).toBe(0); });
});
