// Real server quote generation + payer change on PGlite (Jo, 9 Oct 2026): the drafted quote_items follow the CURRENT
// recorded electrician payer (own = no HIV PIESA line, HIV = standard $349, undecided = held, no quote).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { FEE_AWARENESS_HIV_REC, FEE_AWARENESS_OWN_REC } from "../src/lib/installer-intake.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, installer_quoted text, installer_quoted_price_inc_gst numeric,
  installer_price_includes text, electrician_choice text, estimated_area_m2 numeric, estimated_area_unknown boolean, measure_up_responsibility text,
  ap_fee_override_inc_gst numeric, properties jsonb, next_action text);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, provenance text, measured_area_m2 numeric, verified_area_m2 numeric, supplied_area_m2 numeric, removal_required boolean, existing_r_value numeric);
CREATE TABLE job_imports (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, files jsonb, created_at timestamptz default now());
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text, option_label text, option_code text,
  sent_at timestamptz, subtotal_inc_gst numeric, gst_amount numeric, veec_discount_inc_gst numeric, discount_note text, customer_total_inc_gst numeric, created_by uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE quote_items (id uuid primary key default gen_random_uuid(), quote_id uuid, code text, description text, quantity numeric, unit text, unit_price_inc_gst numeric, line_total_inc_gst numeric, is_other boolean, explanation text, sort int);
CREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, consent_status text, created_at timestamptz default now());
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, label text, required boolean, status text, gate text);
CREATE TABLE veu_location_variables (postcode text, metropolitan_or_regional text, climate_region text);
CREATE TABLE retail_estimator_settings (is_current boolean, ap_management_inc_gst numeric, piesa_assessment_inc_gst numeric, indicative_veec_value numeric, minimum_customer_copayment_inc_gst numeric);
CREATE TABLE workflow_settings (id int, auto_send_quote boolean, customer_comms_enabled boolean, installer_quote_min_inc_gst_per_m2 numeric, installer_quote_max_inc_gst_per_m2 numeric);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, user_id uuid, business_id uuid, active boolean);
CREATE TABLE business_members (business_id uuid, user_id uuid, member_role text, active boolean);
CREATE TABLE electrician_nominations (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, nominating_business_id uuid, nominated_by uuid, nominated_for text, contact_name text, business_name text, email text, phone text, status text, licence_number text, rec_number text, ended_at timestamptz, updated_at timestamptz, created_at timestamptz default now());
CREATE TABLE partner_relationships (installer_business_id uuid, electrician_business_id uuid, active boolean);
CREATE TABLE businesses (id uuid, name text, trading_name text, email text, phone text);
CREATE TABLE invoices (id uuid primary key default gen_random_uuid(), quote_id uuid);
CREATE TABLE profiles (id uuid, full_name text, email text);`);

// Thin adapter over the shared shim: embedded properties(postcode), array inserts and non-head exact counts.
const shim = postgrestShim(db);
const admin = {
  ...shim,
  from(t: string) {
    const b = shim.from(t) as Record<string, (...a: unknown[]) => unknown> & { then: (r: (v: unknown) => unknown, j?: (e: unknown) => unknown) => Promise<unknown> };
    const sel = b.select!, ins = b.insert!, then = b.then.bind(b);
    let wantCount = false;
    b.select = (c?: unknown, o?: unknown) => { const oo = o as { count?: string; head?: boolean } | undefined; if (oo?.count && !oo.head) wantCount = true; return sel(typeof c === "string" ? c.replace("properties(postcode)", "properties") : c, o); };
    b.insert = (p: unknown) => {
      if (!Array.isArray(p)) return ins(p);
      return { then: async (r: (v: unknown) => unknown) => { for (const row of p) { const x = (await shim.from(t).insert(row)) as { error: unknown }; if (x.error) return r(x); } return r({ data: null, error: null }); } };
    };
    b.then = (r, j) => then((v: unknown) => { const x = v as { data: unknown }; return r(wantCount && Array.isArray(x.data) ? { ...x, count: x.data.length } : v); }, j);
    return b;
  },
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: admin }));
class WorkflowError extends Error {}
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const { installerUpdateIntake, draftQuoteFromIntake, installerIntakeState, recordOfficeFeeAwareness } = await import("../src/lib/installer-intake.server");

const JOB = "00000000-0000-0000-0000-00000000e101", BIZ = "00000000-0000-0000-0000-00000000b101", EL = "00000000-0000-0000-0000-00000000b201", U = "00000000-0000-0000-0000-00000000c101";
const base = { areaM2: 142, insulation: "none" as const, quoteStatus: "have_quote" as const, quoteIncGst: 3450, includes: "R5.0 batts supply and install", proposedR: 5, files: [] };
const quotes = async () => (await db.query<{ id: string; status: string; subtotal_inc_gst: string; discount_note: string | null }>("select id, status, subtotal_inc_gst, discount_note from quotes where job_id=$1 order by created_at", [JOB])).rows;
const items = async (qid: string) => (await db.query<{ code: string; line_total_inc_gst: string }>("select code, line_total_inc_gst from quote_items where quote_id=$1 order by sort", [qid])).rows.map((r) => `${r.code}:${Number(r.line_total_inc_gst)}`);
const current = async () => (await quotes()).filter((q) => q.status === "draft");
const evs = async () => (await db.query<{ event_type: string }>("select event_type from workflow_events where job_id=$1 order by created_at", [JOB])).rows.map((r) => r.event_type);

async function seed(choice: string | null) {
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from job_imports; delete from quotes; delete from quote_items; delete from owner_contact_consents; delete from job_assignments; delete from business_members; delete from electrician_nominations; delete from partner_relationships; delete from businesses; delete from invoices; delete from veu_location_variables; delete from retail_estimator_settings; delete from workflow_settings;");
  await db.query("insert into jobs (id, channel, originating_installer_business_id, installer_quoted, installer_quoted_price_inc_gst, installer_price_includes, electrician_choice, properties) values ($1,'installer_sourced',$2,'yes',3450,'R5.0 batts supply and install',$3,'{\"postcode\":\"3000\"}')", [JOB, BIZ, choice]);
  await db.query("insert into ceiling_measurements (job_id, is_current, provenance, supplied_area_m2) values ($1,true,'installer_supplied_provisional',142)", [JOB]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_evidence_acknowledged','{\"proposed_r_value\":5}')", [JOB]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_existing_insulation_declared','{\"value\":\"none\"}')", [JOB]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_commercial_eligibility','{\"outcome\":\"eligible\"}')", [JOB]);
  await db.query("insert into job_imports (job_id, business_id, files) values ($1,$2,'[]')", [JOB, BIZ]);
  await db.query("insert into owner_contact_consents (job_id, consent_status) values ($1,'granted')", [JOB]);
  await db.query("insert into veu_location_variables values ('3000','Metropolitan','Mild')");
  await db.query("insert into retail_estimator_settings values (true, 349, 349, 40, 200)");
  await db.query("insert into workflow_settings values (1, false, false, null, null)");
  await db.query("insert into job_assignments (job_id, role, user_id, business_id, active) values ($1,'installer',$2,$3,true)", [JOB, U, BIZ]);
  await db.query("insert into business_members values ($1,$2,'owner',true)", [BIZ, U]);
  await db.query("insert into partner_relationships values ($1,$2,true)", [BIZ, EL]);
  await db.query("insert into businesses values ($1,'Sample Electrical',null,null,null)", [EL]);
}

describe("server-drafted owner quote follows the CURRENT electrician payer", () => {
  beforeEach(() => seed(null));

  test("HIV arranges: real quote_items carry the standard $349 PIESA line (HIV route unchanged)", async () => {
    await db.query("update jobs set electrician_choice='hivic_organise'");
    await draftQuoteFromIntake(JOB, U);
    const [q] = await current();
    expect(await items(q!.id)).toEqual(["INSTALLER_PRICE:3450", "PIESA:349", "AP_FEE:349"]);
    expect(Number(q!.subtotal_inc_gst)).toBe(4148);
  });

  test("own electrician: NO PIESA line, AP fee kept, separate-invoice note", async () => {
    await db.query("update jobs set electrician_choice='preferred'");
    await draftQuoteFromIntake(JOB, U);
    const [q] = await current();
    expect(await items(q!.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349"]);
    expect(Number(q!.subtotal_inc_gst)).toBe(3799);
    expect(q!.discount_note).toContain("invoices you for it separately");
  });

  test("undecided: no quote drafted (held), never a guessed $349", async () => {
    await draftQuoteFromIntake(JOB, U);
    expect(await quotes()).toEqual([]);
    expect(await evs()).toContain("installer_quote_held");
  });
});

describe("installer changes the payer later on the same job", () => {
  beforeEach(() => seed("hivic_organise"));

  test("HIV -> own: old $349 draft superseded, fresh draft without PIESA, old declaration stops counting", async () => {
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_owner_fee_awareness',$2)", [JOB, JSON.stringify({ by: "installer", payer: "hivic", wording: FEE_AWARENESS_HIV_REC })]);
    await draftQuoteFromIntake(JOB, U);
    const before = (await current())[0]!;
    expect(await items(before.id)).toContain("PIESA:349");
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "own", electrician: { mode: "mine", business_id: EL } });
    const all = await quotes();
    expect(all.find((q) => q.id === before.id)!.status).toBe("superseded");
    const now = await current();
    expect(now.length).toBe(1);
    expect(await items(now[0]!.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349"]);
    const st = await installerIntakeState(JOB);
    expect(st.electricianPayer).toBe("own");
    expect(st.releaseBlockers.some((b) => /fee awareness/i.test(b))).toBe(true);
    expect(await evs()).toContain("installer_owner_fee_awareness_invalidated");
  });

  test("fee declaration for the OLD payer is rejected BEFORE any write (no partial save)", async () => {
    const err = await installerUpdateIntake(JOB, U, BIZ, { ...base, areaM2: 160, electricianPayer: "own", electrician: { mode: "mine", business_id: EL }, feeAwareness: { payer: "hivic", text: FEE_AWARENESS_HIV_REC } }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    const j = (await db.query<{ electrician_choice: string; m: string }>("select electrician_choice, (select supplied_area_m2 from ceiling_measurements limit 1) m from jobs")).rows[0]!;
    expect(j.electrician_choice).toBe("hivic_organise");
    expect(Number(j.m)).toBe(142);
    expect(await evs()).not.toContain("installer_electrician_payer_changed");
  });

  test("new payer + matching declaration saved together; release no longer fee-blocked", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "own", electrician: { mode: "mine", business_id: EL }, feeAwareness: { payer: "own", text: FEE_AWARENESS_OWN_REC } });
    const st = await installerIntakeState(JOB);
    expect(st.releaseBlockers).toEqual([]);
    expect(st.feeRecord?.payer).toBe("own");
    expect(st.feeRecord?.wording).toBe(FEE_AWARENESS_OWN_REC);
  });

  test("own -> to be arranged by installer is refused (office changes a chosen own electrician)", async () => {
    await db.query("update jobs set electrician_choice='preferred'");
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "undecided" })).rejects.toThrow(/ask the office/);
  });

  test("HIV -> to be arranged: draft withdrawn and no new quote", async () => {
    await draftQuoteFromIntake(JOB, U);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "undecided" });
    expect(await current()).toEqual([]);
    expect((await installerIntakeState(JOB)).releaseBlockers.some((b) => /Electrician not decided/.test(b))).toBe(true);
  });

  test("invoice already raised on an accepted quote locks the payer change", async () => {
    const { rows } = await db.query<{ id: string }>("insert into quotes (job_id, kind, status, option_code) values ($1,'installation','accepted','INSTALLER_A1') returning id", [JOB]);
    await db.query("insert into invoices (quote_id) values ($1)", [rows[0]!.id]);
    await expect(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "own", electrician: { mode: "mine", business_id: EL } })).rejects.toThrow(/invoice has already been raised/);
  });

  test("accepted quote (no invoice) is flagged for owner reconfirmation, never repriced", async () => {
    const { rows } = await db.query<{ id: string }>("insert into quotes (job_id, kind, status, option_code, subtotal_inc_gst) values ($1,'installation','accepted','INSTALLER_A1',4148) returning id", [JOB]);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "own", electrician: { mode: "mine", business_id: EL } });
    const acc = (await quotes()).find((q) => q.id === rows[0]!.id)!;
    expect(acc.status).toBe("accepted");
    expect(Number(acc.subtotal_inc_gst)).toBe(4148);
    expect(await evs()).toContain("installer_quote_reconfirmation_required");
  });
});

describe("office fee records are explicit about the payer", () => {
  test("legacy office record (no payer) never clears an own-electrician job", async () => {
    await seed("preferred");
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_owner_fee_awareness','{\"by\":\"office\",\"note\":\"phoned\"}')", [JOB]);
    expect((await installerIntakeState(JOB)).releaseBlockers.some((b) => /different electrician arrangement/.test(b))).toBe(true);
  });
  test("new office record uses the current payer's exact wording", async () => {
    await seed("preferred");
    await recordOfficeFeeAwareness(JOB, U, "Phoned owner 9 Oct");
    const st = await installerIntakeState(JOB);
    expect(st.feeRecord?.by).toBe("office");
    expect(st.feeRecord?.payer).toBe("own");
    expect(st.feeRecord?.wording).toBe(FEE_AWARENESS_OWN_REC);
    expect(st.releaseBlockers).toEqual([]);
  });
  test("office cannot record fees while the electrician is undecided", async () => {
    await seed(null);
    await expect(recordOfficeFeeAwareness(JOB, U, "x")).rejects.toThrow(/who arranges the electrician/);
  });
});
