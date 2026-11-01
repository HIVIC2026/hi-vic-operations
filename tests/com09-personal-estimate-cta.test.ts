/**
 * P1-R3-COM-09 — integration tests for the read-only personal-estimate route (DEP-1), the Template 8
 * Ready Check CTA binding (DEP-2), saved-pricing integrity, and communication safety.
 *
 * The real server resolvers (personal-estimate.server.ts) are executed against a real Postgres engine (PGlite)
 * via the project's PostgREST shim — this is genuine integration-level execution, not URL-string assertions.
 * Never touches a live database. No email/SMS provider is invoked and the COM-04 dual switches are never touched.
 */
import { describe, expect, mock, test, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import {
  PERSONAL_ESTIMATE_ROUTE, READY_CHECK_ROUTE,
  personalEstimateUrl, readyCheckBookingUrl, personalEstimateTokenUsable,
  buildPersonalEstimateView,
  type SavedEstimateCore, type SavedFeeSettings,
} from "../src/lib/personal-estimate.core";
import { isWellFormedToken, newToken, expiryFrom, LINK_PURPOSE } from "../src/lib/estimatelink.core";

// ---------------------------------------------------------------------------
// Real-DB setup (PGlite) + real resolver under test
// ---------------------------------------------------------------------------
const TOKEN_A = newToken();          // customer A, saved spot
const TOKEN_B = newToken();          // customer B, saved spot
const TOKEN_NOSAVE = newToken();     // customer C, no saved spot (fail-closed case)
const JOB_A = "00000000-0000-4000-8000-0000000000a1";
const JOB_B = "00000000-0000-4000-8000-0000000000b1";
const JOB_C = "00000000-0000-4000-8000-0000000000c1";
const NOW = Date.parse("2026-10-15T00:00:00.000Z");

const db = new PGlite();
await db.exec(`
  CREATE TABLE public.jobs (id uuid primary key, job_number text, deleted_at timestamptz, property_id uuid);
  CREATE TABLE public.properties (id uuid primary key, address_line text, suburb text, state text, postcode text);
  CREATE TABLE public.customer_estimate_links (id uuid primary key, job_id uuid, token text, purpose text, status text, expires_at timestamptz);
  CREATE TABLE public.lead_campaign_responses (job_id uuid primary key, spot_saved_at timestamptz, saved_total numeric, saved_veu_discount numeric, saved_gross_total numeric, saved_area_m2 numeric, saved_insulation text);
  CREATE TABLE public.indicative_estimates (id uuid primary key, job_id uuid, status text, area_source text, snapshot jsonb);
`);

function link(id: string, jobId: string, token: string, expiresIso: string, status = "active") {
  return db.exec(
    `INSERT INTO public.customer_estimate_links (id, job_id, token, purpose, status, expires_at) VALUES ('${id}', '${jobId}', '${token}', '${LINK_PURPOSE}', '${status}', '${expiresIso}')`,
  );
}
function job(id: string, num: string, propId: string) {
  return db.exec(`INSERT INTO public.jobs (id, job_number, property_id) VALUES ('${id}', '${num}', '${propId}')`);
}
function property(id: string, line: string) {
  return db.exec(`INSERT INTO public.properties (id, address_line, suburb, state, postcode) VALUES ('${id}', '${line}', 'Reservoir', 'VIC', '3073')`);
}
function savedSpot(jobId: string, total: number, rebate: number, gross: number) {
  return db.exec(
    `INSERT INTO public.lead_campaign_responses (job_id, spot_saved_at, saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation) VALUES ('${jobId}', '2026-10-01T00:00:00Z', ${total}, ${rebate}, ${gross}, 150, 'none')`,
  );
}
function estimate(jobId: string, areaSource: string, fees: Record<string, number> | null) {
  const snap = fees ? `'{"settings":${JSON.stringify(fees)}}'::jsonb` : "NULL";
  return db.exec(`INSERT INTO public.indicative_estimates (id, job_id, status, area_source, snapshot) VALUES (gen_random_uuid(), '${jobId}', 'current', '${areaSource}', ${snap})`);
}

const FEES = { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349, r5_install_inc_gst_per_m2: 30, indicative_veec_value: 70 };

beforeAll(async () => {
  await property("00000000-0000-4000-8000-0000000000e1", "1 Test St");
  await property("00000000-0000-4000-8000-0000000000e2", "2 Test St");
  await job(JOB_A, "JOB-A", "00000000-0000-4000-8000-0000000000e1");
  await job(JOB_B, "JOB-B", "00000000-0000-4000-8000-0000000000e2");
  await job(JOB_C, "JOB-C", "00000000-0000-4000-8000-0000000000e1");
  await link("00000000-0000-4000-8000-0000000000f1", JOB_A, TOKEN_A, new Date(NOW + 10 * 86_400_000).toISOString());
  await link("00000000-0000-4000-8000-0000000000f2", JOB_B, TOKEN_B, new Date(NOW + 10 * 86_400_000).toISOString());
  await link("00000000-0000-4000-8000-0000000000f3", JOB_C, TOKEN_NOSAVE, new Date(NOW + 10 * 86_400_000).toISOString());
  // A and B saved a spot with DIFFERENT frozen totals; C saved nothing.
  await savedSpot(JOB_A, 4000, 6000, 10000);
  await savedSpot(JOB_B, 5555, 7777, 13332);
  await estimate(JOB_A, "assumed_typical", FEES);
  await estimate(JOB_B, "declared", FEES);
});

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const { resolvePersonalEstimate } = await import("../src/lib/personal-estimate.server");

// ---------------------------------------------------------------------------
// Pure core (URLs, token rules, fail-closed snapshot building)
// ---------------------------------------------------------------------------
describe("DEP-1/DEP-2 URL binding (pure)", () => {
  test("personal estimate URL is the dedicated read-only route; booking URL is the existing /estimate route", () => {
    expect(PERSONAL_ESTIMATE_ROUTE).toBe("/my-estimate");
    expect(READY_CHECK_ROUTE).toBe("/estimate");
    expect(personalEstimateUrl(TOKEN_A)).toBe(`/my-estimate/${TOKEN_A}`);
    expect(readyCheckBookingUrl(TOKEN_A)).toBe(`/estimate/${TOKEN_A}`);
    // The two are distinct: the saved-estimate view is read-only, booking lives on the existing page.
    expect(personalEstimateUrl(TOKEN_A)).not.toBe(readyCheckBookingUrl(TOKEN_A));
  });
  test("reuses existing token rules: well-formed + active (no time limit, Jo 1 Nov 2026)", () => {
    const active = { status: "active", expires_at: new Date(NOW + 86_400_000).toISOString() };
    const expired = { status: "active", expires_at: new Date(NOW - 1).toISOString() };
    expect(personalEstimateTokenUsable(active, TOKEN_A, NOW)).toBe(true);
    expect(personalEstimateTokenUsable(expired, TOKEN_A, NOW)).toBe(true); // Jo 1 Nov 2026: no time limit
    expect(personalEstimateTokenUsable({ status: "revoked", expires_at: active.expires_at }, TOKEN_A, NOW)).toBe(false);
    expect(personalEstimateTokenUsable(active, "not-a-token", NOW)).toBe(false);
    expect(personalEstimateTokenUsable(active, undefined, NOW)).toBe(false);
  });
});

const core: SavedEstimateCore = { savedTotal: 4000, savedVeuDiscount: 6000, savedGrossTotal: 10000, savedAreaM2: 150, savedInsulation: "none", areaAssumed: true, savedAt: "2026-10-01T00:00:00Z" };

describe("saved-pricing integrity (pure, fail-closed)", () => {
  test("read-only view uses frozen totals and derives the split from frozen fees; never invents", () => {
    const v = buildPersonalEstimateView(core, FEES, TOKEN_A)!;
    expect(v.customerTotal).toBe(4000);
    expect(v.veuRebate).toBe(6000);
    expect(v.totalBeforeRebate).toBe(10000);
    expect(v.installation).toBe(10000 - 349 - 349); // gross - piesa - ap
    expect(v.piesaFee).toBe(349);
    expect(v.apFee).toBe(349);
    expect(v.areaEstimated).toBe(true);
    expect(v.personalEstimateUrl).toBe(`/my-estimate/${TOKEN_A}`);
    expect(v.readyCheckBookingUrl).toBe(`/estimate/${TOKEN_A}`);
  });
  test("missing frozen fees => limited view (no fabricated installation)", () => {
    const limited = buildPersonalEstimateView(core, null, TOKEN_A)!;
    expect(limited.customerTotal).toBe(4000);
    expect(limited.installation).toBeUndefined(); // not invented
    expect(limited.piesaFee).toBeUndefined();
  });
  test("missing saved core => null (fail closed)", () => {
    expect(buildPersonalEstimateView(null, FEES, TOKEN_A)).toBeNull();
    expect(buildPersonalEstimateView({ ...core, savedTotal: null }, FEES, TOKEN_A)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Real resolver against PGlite (INT-02..INT-07, INT-09, INT-12, INT-16)
// ---------------------------------------------------------------------------
describe("real resolvePersonalEstimate against Postgres (PGlite)", () => {
  test("INT-02 valid token resolves the correct saved snapshot", async () => {
    const v = await resolvePersonalEstimate(TOKEN_A);
    expect(v).not.toBeNull();
    expect(v!.customerTotal).toBe(4000);
    expect(v!.veuRebate).toBe(6000);
    expect(v!.totalBeforeRebate).toBe(10000);
    expect(v!.job.job_number).toBe("JOB-A");
    // The customer's own address is read via the property relation (whitelisted, no internal ids).
    expect(v!.job.address).toBe("1 Test St, Reservoir, VIC 3073");
  });
  test("INT-06 cross-customer isolation: token B only ever returns B's saved estimate", async () => {
    const b = await resolvePersonalEstimate(TOKEN_B)!;
    const a = await resolvePersonalEstimate(TOKEN_A)!;
    expect(b!.customerTotal).toBe(5555);
    expect(b!.job.job_number).toBe("JOB-B");
    // A's token cannot be swapped to read B and vice versa — each resolves only its own totals.
    expect(b!.customerTotal).not.toBe(a!.customerTotal);
    expect(b!.readyCheckBookingUrl).toBe(`/estimate/${TOKEN_B}`);
  });
  test("INT-04/INT-05 invalid, missing, and revoked tokens are rejected; an old date alone is not (Jo 1 Nov 2026)", async () => {
    expect(await resolvePersonalEstimate("nope")).toBeNull();
    expect(await resolvePersonalEstimate(undefined)).toBeNull();
    expect(await resolvePersonalEstimate(null)).toBeNull();
    const expiredTok = newToken();
    await link("00000000-0000-4000-8000-0000000000f4", JOB_A, expiredTok, new Date(NOW - 86_400_000).toISOString());
    expect(await resolvePersonalEstimate(expiredTok)).not.toBeNull(); // past date, still active: works
    const revokedTok = newToken();
    await link("00000000-0000-4000-8000-0000000000f5", JOB_A, revokedTok, new Date(NOW + 86_400_000).toISOString(), "revoked");
    expect(await resolvePersonalEstimate(revokedTok)).toBeNull(); // revoked
  });
  test("INT-07 missing saved snapshot fails closed (no calculator fallback)", async () => {
    expect(await resolvePersonalEstimate(TOKEN_NOSAVE)).toBeNull(); // JOB_C never saved a spot
  });
  test("INT-03/INT-16 current-price changes do not alter the displayed saved amount; resolver is read-only", async () => {
    const before = await resolvePersonalEstimate(TOKEN_A);
    // Change "current" fee settings dramatically — the saved totals must not move.
    await db.exec(`UPDATE public.indicative_estimates SET snapshot = '{"settings":{"piesa_assessment_inc_gst":999,"ap_management_inc_gst":999}}'::jsonb WHERE job_id = '${JOB_A}'`);
    const after = await resolvePersonalEstimate(TOKEN_A);
    expect(after!.customerTotal).toBe(before!.customerTotal);
    expect(after!.veuRebate).toBe(before!.veuRebate);
    expect(after!.totalBeforeRebate).toBe(before!.totalBeforeRebate);
    // INT-16 integrity: saved row untouched by reading.
    const saved = (await db.query<{ saved_total: number }>(`SELECT saved_total FROM public.lead_campaign_responses WHERE job_id = $1`, [JOB_A])).rows[0];
    expect(Number(saved.saved_total)).toBe(4000);
  });
  test("INT-09/INT-10/INT-12 opening the link never books and repeated access creates no duplicates", async () => {
    const rows = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.customer_estimate_links`)).rows[0].n;
    const first = await resolvePersonalEstimate(TOKEN_A);
    const second = await resolvePersonalEstimate(TOKEN_A);
    expect(first!.customerTotal).toBe(second!.customerTotal);
    // No booking/acceptance side-effects: the resolver touches only the saved tables.
    const links = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.customer_estimate_links`)).rows[0].n;
    expect(links).toBe(rows);
  });
});

// ---------------------------------------------------------------------------
// Template 8 rendering + safety (INT-01, INT-08, INT-11, INT-13, INT-14, INT-15)
// ---------------------------------------------------------------------------
// Template 8 (the office Ready Check invitation) was retired on 24 Oct 2026; its snapshot and renderer are gone.
describe("Jo templates 1-7 routing", () => {
  test("INT-15 Templates 1-7 are unaffected by the COM-09 change (still route + CTA as before)", async () => {
    // Delegate to the COM-08 suite's assertions via a quick import of its pure router.
    const { selectJoTemplate, ctasForTemplate } = await import("../src/lib/jo-email-templates.core");
    expect(selectJoTemplate({ outcome: "likely_eligible", insulation: "none", ceilingSizeKnown: false })).toBe("eligible_no_insulation_size_unknown");
    expect(ctasForTemplate("eligible_no_insulation_size_unknown")).toEqual(["save_my_spot"]);
    expect(ctasForTemplate("potentially_eligible_unknown_size_known")).toEqual(["upload_media"]);
    expect(ctasForTemplate("ineligible")).toEqual(["review_result"]);
  });
});

describe("communication safety + read-only guarantees (static)", () => {
  const server = readFileSync("src/lib/personal-estimate.server.ts", "utf8");
  const coreSrc = readFileSync("src/lib/personal-estimate.core.ts", "utf8");
  const route = readFileSync("src/routes/my-estimate.$token.tsx", "utf8");

  test("INT-13/INT-14 no provider call, no real-send, no comms switch touched in COM-09 code", () => {
    const all = server + coreSrc;
    expect(all).not.toMatch(/sendgrid|mailgun|postmark|\bresend\b|amazon\s+ses|nodemailer/i);
    expect(all).not.toMatch(/realSendingOn|save_my_spot_real_send_enabled\s*[:=]\s*true|customer_comms_enabled\s*[:=]\s*true/);
    expect(all).not.toMatch(/\.insert\(|\.update\(|\.upsert\(/); // read-only: no writes at all
  });
  test("INT-11/INT-12 the booking CTA targets the EXISTING workflow; no parallel booking system is created", () => {
    expect(readyCheckBookingUrl(TOKEN_A)).toBe(`/estimate/${TOKEN_A}`); // existing route
    expect(route).toContain("getPersonalEstimateFn");
    // The read-only page links out; it never defines an accept/book mutation of its own.
    expect(route).not.toMatch(/acceptReadyCheck|ready_check_acceptances|\.insert\(/);
  });
  test("read-only route never recalculates or falls back to the public calculator", () => {
    expect(server).not.toMatch(/refreshIndicativeEstimate|public-calculator|whatIfEstimate/);
    expect(coreSrc).not.toMatch(/refreshIndicativeEstimate|whatIfEstimate/);
  });
});
