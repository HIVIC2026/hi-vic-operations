// File-only quote answer (Jo, 9 Oct 2026): explicit Yes/No is kept separate from price readiness. Harness reused from payer-bypass.
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
const { intakeQuoteAnswers } = await import("../src/lib/installer-intake.server");
const { installerProgress } = await import("../src/lib/installer-progress.core");

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


const job = async () => (await db.query<{ installer_quoted: string | null; installer_quoted_price_inc_gst: string | null }>("select installer_quoted, installer_quoted_price_inc_gst from jobs where id=$1", [JOB])).rows[0]!;
const answer = async () => (await intakeQuoteAnswers([JOB])).get(JOB) ?? null;
const FILE = { path: `partners/${BIZ}/quote.pdf`, name: "quote.pdf", type: "application/pdf" };
const next = (a: "have_quote" | "not_quoted" | null, amountKnown: boolean) => installerProgress({ coordination: "hivic_managed", quoted: a === "have_quote" ? "yes" : a === "not_quoted" ? "no" : null, quoteAmountKnown: amountKnown, eligibility: "eligible", quoteHeld: ["Enter the quote amount inc GST"], quoteStatus: "none", quoteDelivery: "none", reconfirmationRequired: false, electricianPayer: "hivic", electricalCleared: false, installationCompleted: false, evidence: [], evidenceApprovedAt: null, veecStatus: null, stage: "ready_for_installer_quotes" }).next;
const fileOnly = async () => { await db.exec("update jobs set installer_quoted=null, installer_quoted_price_inc_gst=null, installer_price_includes=null"); await db.query("insert into workflow_events (job_id, event_type, details, created_at) values ($1,'installer_quote_answer','{\"answer\":\"have_quote\",\"source\":\"intake\"}', now() - interval '1 hour')", [JOB]); };

describe("explicit measured-and-quoted answer", () => {
  beforeEach(() => seed("hivic_organise"));

  test("Yes + uploaded quote, no typed amount: answer Yes, price stays null, HIV reads the quote (not 'measure again')", async () => {
    await fileOnly();
    expect(await answer()).toBe("have_quote");
    expect((await job()).installer_quoted).toBeNull();
    expect((await job()).installer_quoted_price_inc_gst).toBeNull();
    const n = next(await answer(), false);
    expect(n.who).toBe("Home Insulation Victoria");
    expect(n.text).toContain("uploaded quote");
    expect(n.text).not.toMatch(/Ready Check|Measure/);
  });

  test("later No overrides retained original files", async () => {
    await fileOnly();
    await db.query("update job_imports set files=$1 where job_id=$2", [JSON.stringify([FILE]), JOB]);
    await installerUpdateIntake(JOB, U, BIZ, { ...base, quoteStatus: "not_quoted", quoteIncGst: null, includes: null, proposedR: null, files: [] } as never);
    expect(await answer()).toBe("not_quoted");
    expect((await job()).installer_quoted).toBe("no");
    expect(next(await answer(), false).text).toContain("Ready Check");
  });

  test("No -> Yes with file only: Yes recorded, no fabricated price", async () => {
    await db.exec("update jobs set installer_quoted='no', installer_quoted_price_inc_gst=null, installer_price_includes=null");
    expect(await answer()).toBe("not_quoted");
    await installerUpdateIntake(JOB, U, BIZ, { ...base, quoteStatus: "have_quote", quoteIncGst: null, includes: null, files: [FILE] } as never);
    expect(await answer()).toBe("have_quote");
    const j = await job();
    expect(j.installer_quoted).toBeNull();
    expect(j.installer_quoted_price_inc_gst).toBeNull();
  });

  test("explicit Yes pending office extraction keeps HIV as next party even with amount holds", async () => {
    await fileOnly();
    expect(next(await answer(), false).who).toBe("Home Insulation Victoria");
  });

  test("no recorded answer and no installer_quoted is unknown (never inferred from files)", async () => {
    await db.exec("update jobs set installer_quoted=null");
    await db.query("update job_imports set files=$1 where job_id=$2", [JSON.stringify([FILE]), JOB]);
    expect(await answer()).toBeNull();
  });
});

describe("initial No, later current prepared draft (real rows)", () => {
  beforeEach(() => seed("hivic_organise"));
  const { currentQuote } = await import("../src/lib/installer-progress.core");
  for (const coordination of ["hivic_managed", "self_managed"] as const) test(`${coordination}: draft outranks the old No answer`, async () => {
    await db.exec("update jobs set installer_quoted='no', installer_quoted_price_inc_gst=null, installer_price_includes=null");
    await db.query("insert into quotes (job_id, kind, status, release_state, release_hold_reason) values ($1,'installation','draft','held','Owner fee confirmation needed')", [JOB]);
    const a = await answer(); expect(a).toBe("not_quoted");
    const rows = (await db.query<{ status: string; created_at: string; release_state: string; release_hold_reason: string; sent_at: string | null }>("select status, created_at::text, release_state, release_hold_reason, sent_at from quotes where job_id=$1", [JOB])).rows;
    const q = currentQuote(rows);
    const r = installerProgress({ coordination, quoted: "no", quoteAmountKnown: false, eligibility: "eligible", quoteHeld: [], quoteStatus: q.status, quoteDelivery: q.delivery, quoteHoldReason: q.row?.release_hold_reason ?? null, reconfirmationRequired: false, electricianPayer: "hivic", electricalCleared: false, installationCompleted: false, evidence: [], evidenceApprovedAt: null, veecStatus: null, stage: "ready_for_installer_quotes" });
    expect(r.next.who).toBe("Home Insulation Victoria");
    expect(r.next.text).toBe("Review and complete the owner quote — on hold: Owner fee confirmation needed");
    expect(r.next.text).not.toMatch(/Ready Check|Measure/);
    expect(r.steps.find((s) => s.key === "quote")!.state).not.toBe("done");
  });
  test("no draft + No still asks for the Ready Check", async () => {
    await db.exec("update jobs set installer_quoted='no'");
    expect(next(await answer(), false).text).toContain("Ready Check");
  });
});
