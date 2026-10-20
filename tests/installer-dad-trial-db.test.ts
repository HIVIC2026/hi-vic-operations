// Dad-trial review (Jo 20 Oct): real installerUpdateIntake/installerIntakeState on PGlite for the four attendance/quote shapes.
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
const drafted: unknown[] = [];
mock.module("../src/lib/installer-quote.server", () => ({ draftInstallerQuoteFromReadyCheck: async (...a: unknown[]) => { drafted.push(a[4]); return { ready: true }; } }));
const { installerUpdateIntake, installerIntakeState, draftQuoteFromIntake, intakeSendBlockers } = await import("../src/lib/installer-intake.server");
const { buildInstallerQuoteDraft, piesaChargeIncGst } = await import("../src/lib/installer-led.core");
const { melbourneToday, visitDateProblem } = await import("../src/lib/installer-intake.core");

const JOB = "00000000-0000-0000-0000-00000000e001", BIZ = "00000000-0000-0000-0000-00000000b001", U = "00000000-0000-0000-0000-00000000c001";
const base = { areaM2: 120, insulation: "below_r2" as const, quoteStatus: "have_quote" as const, quoteIncGst: 3000, includes: "R5.0 batts supply and install", proposedR: 5, files: [], attended: "attended" as const };
const good = { basis: "before_discount" as const, gst: "inc_gst" as const, inclusions: "R5.0 batts supply and install", exclusions: null, originalStatus: "sent" as const, removalPricing: null, removalAmountIncGst: null, extras: [] as { description: string; pricing: "included" | "additional" | "not_priced"; amountIncGst: number | null }[] };
const evs = async (t: string) => (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [JOB, t])).rows;
const comBlockers = async () => (await installerIntakeState(JOB)).readiness.blockers.filter((b) => /VEU discount|GST|Removal is required|removal price|Extra|Clarify the installer quote/.test(b));

beforeEach(async () => {
  drafted.length = 0;
  await db.exec("delete from jobs; delete from workflow_events; delete from ceiling_measurements; delete from job_imports; delete from quotes;");
  await db.query("insert into jobs (id, channel, originating_installer_business_id, installer_quoted, estimated_area_unknown) values ($1,'installer_sourced',$2,'no',true)", [JOB, BIZ]);
  await db.query("insert into workflow_events (job_id, event_type, details) values ($1,'installer_evidence_acknowledged','{\"proposed_r_value\":null}'),($1,'installer_existing_insulation_declared','{\"value\":\"below_r2\"}'),($1,'installer_commercial_eligibility','{\"outcome\":\"eligible\"}')", [JOB]);
  await db.query("insert into job_imports (job_id, business_id, files) values ($1,$2,'[]')", [JOB, BIZ]);
});

const st = () => installerIntakeState(JOB);
describe("Dad trial shapes: edit -> read", () => {
  test("unvisited + unpriced: saves, Ready Check still needed, no quote", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, attended: "not_attended", quoteStatus: "not_quoted", quoteIncGst: null, includes: null });
    const s = await st();
    expect(s.attended).toBe("no"); expect(s.readiness.ready).toBe(false);
  });
  test("attended + quoted (customer already quoted)", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, commercial: good, attendedOn: melbourneToday() });
    const s = await st();
    expect(s.attended).toBe("yes");
  });
  test("measured + unpriced keeps the measurement", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, quoteStatus: "not_quoted", quoteIncGst: null, includes: null });
    const s = await st(); expect(s.areaM2).toBe(120); expect(s.quoteIncGst ?? null).toBeNull();
  });
  test("unvisited + quoted is preliminary and still needs onsite", async () => {
    await installerUpdateIntake(JOB, U, BIZ, { ...base, attended: "not_attended", commercial: good });
    const s = await st();
    expect(s.readiness.ready).toBe(false);
  });
  test("unknown history + quote asks for clarification, never assumes a visit", async () => {
    const { attended: _a, ...noAtt } = base;
    await installerUpdateIntake(JOB, U, BIZ, { ...noAtt, commercial: good });
    const s = await st();
    expect(s.attended).toBeNull(); expect(s.readiness.ready).toBe(false);
  });
});

describe("next step wording", () => {
  test("unknown visit + quote asks for clarification instead of promising the owner quote", async () => {
    const { intakeNextAction } = await import("../src/lib/installer-intake.core");
    expect(intakeNextAction(null, true, null)).toMatch(/^Confirm whether the property was visited/);
    expect(intakeNextAction(null, true, "attended")).toBe("Home Insulation Victoria checks the owner's eligibility, then prepares the owner quote.");
  });
});
