// Jo 27 Oct 2026 (HV-3197, "Ignore it"): when the business owner's price card is the price (an `installer_price_set`
// event, decision 278), the Mitti form's difficult-access charge/fee never reaches the owner quote — no "Includes
// difficult access" text and no access-fee hold. Old forms with no price-card entry keep today's behaviour.
// Real draftInstallerQuoteFromReadyCheck on PGlite (fake TEST rows only); nothing is sent.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, electrician_choice text, ap_fee_override_inc_gst numeric, properties jsonb, stage text DEFAULT 'measured_estimate_ready',
  deleted_at timestamptz, qa_archived_at timestamptz, source text DEFAULT 'qa_test', job_number text DEFAULT 'HV-TEST');
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, measured_area_m2 numeric, verified_area_m2 numeric, removal_required boolean);
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text, option_label text, option_code text,
  sent_at timestamptz, subtotal_inc_gst numeric, gst_amount numeric, veec_discount_inc_gst numeric, discount_note text, customer_total_inc_gst numeric, created_by uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, description text, quantity numeric, unit text, unit_price_inc_gst numeric, line_total_inc_gst numeric, is_other boolean, explanation text, sort int);
CREATE TABLE veu_location_variables (postcode text, metropolitan_or_regional text, climate_region text);
CREATE TABLE retail_estimator_settings (is_current boolean, ap_management_inc_gst numeric, piesa_assessment_inc_gst numeric, indicative_veec_value numeric, minimum_customer_copayment_inc_gst numeric);
CREATE TABLE workflow_settings (id int, auto_send_quote boolean, customer_comms_enabled boolean);
CREATE TABLE admin_config_events (id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);

// Same thin adapter as installer-payer-quote-db: embedded properties(postcode) and array inserts.
const shim = postgrestShim(db);
/** When true, the price-card read (`installer_price_set`) returns a database error. */
let failPriceRead = false;
const admin = {
  ...shim,
  from(t: string) {
    const b = shim.from(t) as Record<string, (...a: unknown[]) => unknown>;
    const sel = b.select!, ins = b.insert!, eq = b.eq!;
    b.eq = (c: unknown, v: unknown) => {
      if (failPriceRead && t === "workflow_events" && c === "event_type" && v === "installer_price_set") b.then = (r: (x: unknown) => unknown) => Promise.resolve(r({ data: null, error: { message: "read failed" } }));
      return eq(c, v);
    };
    b.select = (c?: unknown, o?: unknown) => sel(typeof c === "string" ? c.replace("properties(postcode)", "properties") : c, o);
    b.insert = (p: unknown) => {
      if (!Array.isArray(p)) return ins(p);
      return { then: async (r: (v: unknown) => unknown) => { for (const row of p) { const x = (await shim.from(t).insert(row)) as { error: unknown }; if (x.error) return r(x); } return r({ data: null, error: null }); } };
    };
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const { draftInstallerQuoteFromReadyCheck } = await import("../src/lib/installer-quote.server");

const JOB = "00000000-0000-0000-0000-00000000e301", BIZ = "00000000-0000-0000-0000-00000000b301", U = "00000000-0000-0000-0000-00000000c301";
const form = (fee: string | null) => [
  { label: "Homeowner agrees to be contacted by Home Insulation Victoria", value: "Yes" },
  { label: "What insulation product will you be using on this job?", value: "Bradford Gold R5" },
  { label: "What's included in your quote?", value: "Ceiling insulation - supply & install" },
  { label: "Total quoted price (inc GST)", value: "2800" },
  { label: "Is there a difficult access charge?", value: "Yes" },
  { label: "Difficult access fee ($ inc GST)", value: fee },
];
const draftNow = async () => (await db.query<{ id: string; release_hold_reason: string }>("select id, release_hold_reason from quotes where job_id=$1 and status='draft'", [JOB])).rows;
const installerLine = async (qid: string) => (await db.query<{ description: string; line_total_inc_gst: string }>("select description, line_total_inc_gst from quote_items where quote_id=$1 and code='INSTALLER_PRICE'", [qid])).rows[0]!;
const setCardPrice = (price: number) => db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_price_set',$2)", [JOB, JSON.stringify({ price_inc_gst: price, included: ["Ceiling insulation - supply & install"], included_other: null })]);

beforeEach(async () => {
  failPriceRead = false;
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from quotes; delete from quote_items; delete from veu_location_variables; delete from retail_estimator_settings; delete from workflow_settings; delete from admin_config_events;");
  await db.query("insert into jobs (id, channel, originating_installer_business_id, electrician_choice, properties) values ($1,'installer_sourced',$2,'hivic_organise','{\"postcode\":\"3000\"}')", [JOB, BIZ]);
  await db.query("insert into ceiling_measurements (job_id, is_current, measured_area_m2, removal_required) values ($1,true,120,false)", [JOB]);
  await db.query("insert into veu_location_variables values ('3000','Metropolitan','Mild')");
  await db.query("insert into retail_estimator_settings values (true, 349, 349, 40, 200)");
  await db.query("insert into workflow_settings values (1, false, false)");
});

describe("price card is the only price: the Mitti access fee is ignored", () => {
  test("card $3,000 + Mitti access fee $200 → line has no 'difficult access', priced at the card's $3,000", async () => {
    await setCardPrice(3000);
    await draftInstallerQuoteFromReadyCheck(JOB, U, form("200"), "audit_card");
    const [q] = await draftNow();
    expect(q).toBeDefined();
    const line = await installerLine(q!.id);
    expect(Number(line.line_total_inc_gst)).toBe(3000);
    expect(line.description).not.toMatch(/difficult access/i);
  });
  test("card price + Mitti access charge with no usable fee → no access-fee hold", async () => {
    await setCardPrice(3000);
    await draftInstallerQuoteFromReadyCheck(JOB, U, form(null), "audit_card");
    const [q] = await draftNow();
    expect(q).toBeDefined();
    expect(q!.release_hold_reason).not.toMatch(/difficult access/i);
    expect((await installerLine(q!.id)).description).not.toMatch(/difficult access/i);
  });
});

describe("old forms with no price-card entry keep today's behaviour", () => {
  test("form price + access fee $200 → line still says 'Includes difficult access ($200)'", async () => {
    await draftInstallerQuoteFromReadyCheck(JOB, U, form("200"), "audit_old");
    const [q] = await draftNow();
    expect(q).toBeDefined();
    const line = await installerLine(q!.id);
    expect(Number(line.line_total_inc_gst)).toBe(2800);
    expect(line.description).toContain("Includes difficult access ($200)");
  });
  test("form price + access charge with no usable fee → held for the office to confirm the fee", async () => {
    await draftInstallerQuoteFromReadyCheck(JOB, U, form(null), "audit_old");
    const [q] = await draftNow();
    expect(q).toBeDefined();
    expect(q!.release_hold_reason).toContain("confirm the difficult access fee");
  });
});

// Review fix (27 Oct 2026): a failed price-card read must not withdraw a good draft. The draft step stops (throws) so the
// 15-minute tick retries; it never falls back to the old form price or brings the Mitti access fee back.
describe("price-card read fails", () => {
  test("existing card-priced draft untouched, no new draft, access fee not reintroduced", async () => {
    await setCardPrice(3000);
    await draftInstallerQuoteFromReadyCheck(JOB, U, form("200"), "audit_card");
    const [before] = await draftNow();
    expect(before).toBeDefined();
    failPriceRead = true;
    await expect(draftInstallerQuoteFromReadyCheck(JOB, U, form("200"), "audit_card")).rejects.toThrow();
    failPriceRead = false;
    const after = await draftNow();
    expect(after.map((q) => q.id)).toEqual([before!.id]);
    expect(after[0]!.release_hold_reason).toBe(before!.release_hold_reason);
    const line = await installerLine(before!.id);
    expect(Number(line.line_total_inc_gst)).toBe(3000);
    expect(line.description).not.toMatch(/difficult access/i);
    expect((await db.query("select id from quotes where job_id=$1", [JOB])).rows).toHaveLength(1);
  });
});
