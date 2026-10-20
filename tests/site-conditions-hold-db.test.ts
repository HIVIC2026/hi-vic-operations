// "Site conditions differ" hold through the real installerIntakeState + prestart reader on PGlite (Jo 20 Oct brief).
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { intakeArea, intakeProblems, intakeQuotePayload, pickIntakeChanges } from "../src/lib/installer-intake.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, channel text, originating_installer_business_id uuid, installer_site_check text, installer_site_check_date date, installer_quoted text, installer_quoted_price_inc_gst numeric,
  installer_price_includes text, electrician_choice text, estimated_area_m2 numeric, estimated_area_unknown boolean, measure_up_responsibility text);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, role text, active boolean, user_id uuid, business_id uuid);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, created_by uuid, raw_snapshot jsonb,
  source_role text, external_source text, external_id text, provenance text, measured_area_m2 numeric, removal_required boolean, removal_m2 numeric, existing_r_value numeric,
  insulation_present boolean, supplied_area_m2 numeric, supplied_removal_m2 numeric, supplied_snapshot jsonb, measurement_method text, measurement_purpose text,
  measured_by_name text, measured_by_role text, measured_by_business_id uuid, measured_on date, gross_area_m2 numeric, excluded_area_m2 numeric, confidence text,
  review_flags jsonb, evidence_notes text, status text, verified_area_m2 numeric);
CREATE TABLE job_imports (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, files jsonb, created_at timestamptz default now());
CREATE TABLE quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, release_state text, release_hold_reason text);
CREATE TABLE owner_contact_consents (id uuid primary key default gen_random_uuid(), job_id uuid, consent_status text, created_at timestamptz default now());
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text, label text, required boolean, status text, gate text);`);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class WorkflowError extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const { installerIntakeState, siteConditionsHoldFor } = await import("../src/lib/installer-intake.server");
const { SITE_HOLD_RAISED, SITE_HOLD_CLEARED, siteConditionsHold } = await import("../src/lib/site-conditions.core");
const { prestartFailures } = await import("../src/lib/prestart.core");

const JOB = "00000000-0000-0000-0000-00000000e001", BIZ = "00000000-0000-0000-0000-00000000b001", OTHER = "00000000-0000-0000-0000-00000000b002", U = "00000000-0000-0000-0000-00000000c001";
const base = { areaM2: null, insulation: "unknown" as const, quoteStatus: "not_quoted" as const, quoteIncGst: null, includes: null, proposedR: null, files: [] };
const job = async () => (await db.query<Record<string, unknown>>("select * from jobs where id=$1", [JOB])).rows[0]!;
const ms = async () => (await db.query<Record<string, unknown>>("select * from ceiling_measurements where job_id=$1", [JOB])).rows;
const evs = async () => (await db.query<{ event_type: string }>("select event_type from workflow_events where job_id=$1 order by created_at", [JOB])).rows.map((r) => r.event_type);

beforeEach(async () => {
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from job_imports; delete from quotes;");
  // State as saved by a BEFORE VISIT + NO AREA + NOT QUOTED submit: null facts, quoted 'no'.
  await db.query("insert into jobs (id, channel, originating_installer_business_id, installer_quoted, estimated_area_unknown) values ($1,'installer_sourced',$2,'no',true)", [JOB, BIZ]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_evidence_acknowledged','{\"proposed_r_value\":null}'),($1,'installer_existing_insulation_declared','{\"existing_insulation\":\"unknown\"}')", [JOB]);
  await db.query("insert into job_imports (job_id, business_id, files) values ($1,$2,'[]')", [JOB, BIZ]);
});


const ev = (t: string, at: string, note?: string) => db.query("insert into workflow_events (job_id, event_type, details, created_at) values ($1,$2,$3,$4)", [JOB, t, JSON.stringify(note ? { note } : {}), at]);
const blk = async () => (await installerIntakeState(JOB)).readiness.blockers;

describe("Site conditions differ hold", () => {
  test("no events → not open, no hold blocker", async () => { expect((await siteConditionsHoldFor(JOB)).open).toBe(false); expect((await blk()).some((b) => /Site conditions differ/.test(b))).toBe(false); });
  test("raised → open, blocks the owner quote with the installer's note", async () => {
    await ev(SITE_HOLD_RAISED, "2026-10-20T01:00:00Z", "Second roof void not in quote");
    const s = await installerIntakeState(JOB);
    expect(s.siteHold.open).toBe(true); expect(s.readiness.ready).toBe(false);
    expect(s.readiness.blockers).toContain("Site conditions differ — office review required before the quote or works can continue: Second roof void not in quote");
  });
  test("office clear after raise → closed; a later re-raise reopens", async () => {
    await ev(SITE_HOLD_RAISED, "2026-10-20T01:00:00Z", "x differs"); await ev(SITE_HOLD_CLEARED, "2026-10-20T02:00:00Z");
    expect((await siteConditionsHoldFor(JOB)).open).toBe(false);
    await ev(SITE_HOLD_RAISED, "2026-10-20T03:00:00Z", "again");
    expect((await siteConditionsHoldFor(JOB)).open).toBe(true);
  });
  test("same-instant raise/clear resolves OPEN (fail closed)", () => {
    expect(siteConditionsHold([{ event_type: SITE_HOLD_CLEARED, created_at: "t" }, { event_type: SITE_HOLD_RAISED, created_at: "t" }]).open).toBe(true);
  });
  test("start of works is blocked while the hold is open", () => {
    const f = prestartFailures({ start: "2026-10-25T00:00:00Z", clearance: { cleared: true, blocker: null }, deadline: "2026-11-30", esc: null, lead: { found: false, status: null, level: null, expiresOn: null, name: null }, consentBlockers: [], piesaCompletedAt: "2026-10-20", siteHoldBlockers: ["Site conditions differ — office review required before the quote or works can continue"] });
    expect(f).toContain("Site conditions differ — office review required before the quote or works can continue");
  });
  test("unreadable hold history throws, never 'no hold'", async () => {
    await db.exec("alter table workflow_events rename to workflow_events_x");
    try { await expect(siteConditionsHoldFor(JOB)).rejects.toThrow(/could not load/); } finally { await db.exec("alter table workflow_events_x rename to workflow_events"); }
  });
});
