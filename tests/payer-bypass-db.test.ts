// Source-confirmed bypass (Jo, 9 Oct 2026): the legacy electrician switch must not change an Add job payer, every
// payer path shares one lock, and send/accept re-check that the quote lines match the CURRENT payer (real PGlite rows).
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
const { installerUpdateIntake, draftQuoteFromIntake } = await import("../src/lib/installer-intake.server");
const { switchJobToHivic, payerChangeBlocker } = await import("../src/lib/job-electrician.server");
const { quoteBillingBlocker } = await import("../src/lib/installer-quote.server");

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

const choice = async () => (await db.query<{ electrician_choice: string | null }>("select electrician_choice from jobs where id=$1", [JOB])).rows[0]!.electrician_choice;
const err = (p: Promise<unknown>) => p.then(() => "accepted", (e) => (e as Error).message);

describe("legacy job-card switch can no longer bypass the Add job rules", () => {
  beforeEach(() => seed("preferred"));

  test("own -> HIV through the old switch is refused on an Add job job; payer, nominations and quote untouched", async () => {
    await db.query("insert into electrician_nominations (job_id, business_id, contact_name) values ($1,$2,'Sample')", [JOB, EL]);
    await draftQuoteFromIntake(JOB, U);
    const before = await current();
    const r = await err(switchJobToHivic(JOB, U));
    expect(r).toMatch(/job's details/);
    expect(await choice()).toBe("preferred");
    expect((await db.query("select id from electrician_nominations where ended_at is null")).rows.length).toBe(1);
    expect((await current()).map((q) => q.id)).toEqual(before.map((q) => q.id));
    expect(await evs()).not.toContain("electrician_choice_changed");
  });

  test("non-Add-job installer job: old switch blocked once the quote is accepted, and once the invoice is raised", async () => {
    await db.query("delete from workflow_events where event_type='installer_evidence_acknowledged'");
    const q = (await db.query<{ id: string }>("insert into quotes (job_id, kind, status, option_code) values ($1,'installation','accepted','INSTALLER_A1') returning id", [JOB])).rows[0]!.id;
    expect(await err(switchJobToHivic(JOB, U))).toMatch(/already accepted the quote/);
    await db.query("insert into invoices (quote_id) values ($1)", [q]);
    expect(await payerChangeBlocker(JOB)).toMatch(/invoice has already been raised/);
    expect(await err(switchJobToHivic(JOB, U))).toMatch(/invoice has already been raised/);
    expect(await choice()).toBe("preferred");
  });

  test("non-Add-job job with no quote: old switch still works (legacy path kept)", async () => {
    await db.query("delete from workflow_events where event_type='installer_evidence_acknowledged'");
    await db.query("insert into electrician_nominations (job_id, business_id, contact_name) values ($1,$2,'Sample')", [JOB, EL]);
    expect(await err(switchJobToHivic(JOB, U))).toBe("accepted");
    expect(await choice()).toBe("hivic_organise");
  });
});

describe("send/accept re-check quote lines against the CURRENT payer (any path)", () => {
  beforeEach(() => seed("preferred"));

  test("own quote (no PIESA) is blocked once payer is HIV, even with a fresh HIV fee declaration; fresh draft clears it", async () => {
    await draftQuoteFromIntake(JOB, U);
    const own = (await current())[0]!;
    expect(await items(own.id)).toEqual(["INSTALLER_PRICE:3450", "AP_FEE:349"]);
    expect(await quoteBillingBlocker(own.id)).toBeNull();
    await db.query("update jobs set electrician_choice='hivic_organise'"); // simulated alternate writer
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_owner_fee_awareness',$2)", [JOB, JSON.stringify({ by: "installer", payer: "hivic", wording: FEE_AWARENESS_HIV_REC })]);
    expect(await quoteBillingBlocker(own.id)).toMatch(/no PIESA line/);
    await draftQuoteFromIntake(JOB, U);
    const fresh = (await current())[0]!;
    expect(fresh.id).not.toBe(own.id);
    expect(await items(fresh.id)).toContain("PIESA:349");
    expect(await quoteBillingBlocker(fresh.id)).toBeNull();
  });

  test("HIV quote with PIESA is blocked if payer became own; undecided blocks; accepted quotes are frozen (never re-checked)", async () => {
    await db.query("update jobs set electrician_choice='hivic_organise'");
    await draftQuoteFromIntake(JOB, U);
    const q = (await current())[0]!;
    await db.query("update jobs set electrician_choice='preferred'");
    expect(await quoteBillingBlocker(q.id)).toMatch(/invoices them directly/);
    await db.query("update jobs set electrician_choice=null");
    expect(await quoteBillingBlocker(q.id)).toMatch(/not decided/);
    await db.query("update quotes set status='accepted' where id=$1", [q.id]);
    expect(await quoteBillingBlocker(q.id)).toBeNull();
    expect(await items(q.id)).toEqual(["INSTALLER_PRICE:3450", "PIESA:349", "AP_FEE:349"]);
  });

  test("accepted quote + invoice: payer change via the editor refused BEFORE any write; facts and quote unchanged", async () => {
    await db.query("update jobs set electrician_choice='hivic_organise'");
    const q = (await db.query<{ id: string }>("insert into quotes (job_id, kind, status, option_code) values ($1,'installation','accepted','INSTALLER_A1') returning id", [JOB])).rows[0]!.id;
    await db.query("insert into invoices (quote_id) values ($1)", [q]);
    const r = await err(installerUpdateIntake(JOB, U, BIZ, { ...base, areaM2: 150, electricianPayer: "own", electrician: { mode: "mine", business_id: EL } }));
    expect(r).toMatch(/invoice has already been raised/);
    expect(await choice()).toBe("hivic_organise");
    expect(Number((await db.query<{ supplied_area_m2: string }>("select supplied_area_m2 from ceiling_measurements")).rows[0]!.supplied_area_m2)).toBe(142);
    expect((await quotes()).map((x) => x.status)).toEqual(["accepted"]);
  });
});

describe("draft reuse compares full scope, not just code + amount", () => {
  beforeEach(() => seed("hivic_organise"));
  test("same amount, changed inclusions -> new draft (old superseded)", async () => {
    await draftQuoteFromIntake(JOB, U);
    const a = (await current())[0]!;
    await db.query("update jobs set installer_price_includes='R6.0 batts supply and install, old insulation removed'");
    await draftQuoteFromIntake(JOB, U);
    const b = (await current())[0]!;
    expect(b.id).not.toBe(a.id);
    expect((await quotes()).find((x) => x.id === a.id)!.status).toBe("superseded");
  });
  test("identical facts -> same draft reused (no duplicate)", async () => {
    await draftQuoteFromIntake(JOB, U);
    await draftQuoteFromIntake(JOB, U);
    expect((await quotes()).length).toBe(1);
  });
});

describe("uncommitted own electrician can be corrected through the guarded editor", () => {
  beforeEach(async () => { await seed("preferred"); await db.exec("update business_members set member_role='business_admin'"); });

  test("own, no accepted quote/invoice/REC -> HIV: nomination ended, fee invalidated, fresh held draft has PIESA", async () => {
    await db.query("insert into electrician_nominations (job_id, business_id, contact_name) values ($1,$2,'Sample')", [JOB, EL]);
    await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_owner_fee_awareness',$2)", [JOB, JSON.stringify({ by: "installer", payer: "own", wording: FEE_AWARENESS_OWN_REC })]);
    await draftQuoteFromIntake(JOB, U);
    const before = (await current())[0]!;
    expect(await items(before.id)).not.toContain("PIESA:349");
    await installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "hivic" } as never);
    expect(await choice()).toBe("hivic_organise");
    expect((await db.query("select id from electrician_nominations where ended_at is null")).rows.length).toBe(0);
    expect(await evs()).toContain("installer_owner_fee_awareness_invalidated");
    const drafts = await current();
    expect(drafts.some((q) => q.id === before.id)).toBe(false);
    const fresh = (await quotes()).filter((q) => q.status === "draft").pop();
    expect(fresh).toBeDefined(); expect(await items(fresh!.id)).toContain("PIESA:349");
    const held = (await db.query<{ release_state: string }>("select release_state from quotes where status='draft'")).rows;
    for (const h of held) expect(h.release_state).toBe("held");
  });

  test("committed own (accepted owner quote) stays refused with no mutation", async () => {
    await db.query("insert into electrician_nominations (job_id, business_id, contact_name) values ($1,$2,'Sample')", [JOB, EL]);
    await db.query("insert into quotes (job_id, kind, status, release_state) values ($1,'installation','accepted','released')", [JOB]);
    const evBefore = (await evs()).length;
    const r = await err(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "hivic" } as never));
    expect(r).toMatch(/accepted a quote with your own electrician/);
    expect(await choice()).toBe("preferred");
    expect((await db.query("select id from electrician_nominations where ended_at is null")).rows.length).toBe(1);
    expect((await evs()).length).toBe(evBefore);
  });

  test("staff member cannot change an own choice", async () => {
    await db.exec("update business_members set member_role='member'");
    expect(await err(installerUpdateIntake(JOB, U, BIZ, { ...base, electricianPayer: "hivic" } as never))).toMatch(/business owner/);
    expect(await choice()).toBe("preferred");
  });
});
