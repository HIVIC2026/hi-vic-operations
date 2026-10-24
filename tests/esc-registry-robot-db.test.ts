// Decision 272: the robot's record paths on a practice Postgres (PGlite + PostgREST shim), never the live database.
// Proves: a robot submission lands on esc_notifications exactly like an office record (status sent, reference,
// method adapter, the 0016 CHECK satisfied) with the SAME event name; a second record is refused (idempotent); a
// non-ready notice is refused; VEEC creation becomes a "submitted" lodgement through veec.core's rules and never twice;
// a failure is an open Needs me row until the notice is recorded as sent. Consent/window checks are the shared
// esc.server assertCanSubmit (mocked here – covered by tests/esc-registry.test.ts).
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const JOB = "00000000-0000-4000-8000-00000000000a", JOB2 = "00000000-0000-4000-8000-00000000000b";
const N1 = "00000000-0000-4000-8000-0000000000e1", N2 = "00000000-0000-4000-8000-0000000000e2";
const START = "2026-11-04T22:00:00Z";
const db = new PGlite();
await db.exec(`
  create table public.jobs(id uuid primary key, job_number text not null, source text not null default 'website', stage text not null, last_activity_at timestamptz);
  insert into public.jobs(id, job_number, stage) values ('${JOB}', 'HV-1', 'installation_booked'), ('${JOB2}', 'HV-2', 'ready_for_veec');
  create table public.workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb,
    from_stage text, to_stage text, internal boolean not null default false, created_at timestamptz not null default clock_timestamp());
  create table public.esc_notifications(id uuid primary key, job_id uuid not null, version int not null default 1, scheduled_start timestamptz not null, consent_id uuid,
    payload_json jsonb not null default '{}'::jsonb, status text not null default 'not_ready' check (status in ('not_ready','configuration_required','ready','pending_submission','sent','accepted','error','stale','cancelled')),
    sent_at timestamptz, submission_method text, submission_reference text, submitted_by uuid, response jsonb, last_error text, updated_at timestamptz not null default now(),
    constraint esc_sent_needs_reference check (status not in ('sent','accepted') or (sent_at is not null and submission_reference is not null and submission_method is not null)));
  insert into public.esc_notifications(id, job_id, scheduled_start, consent_id, status, payload_json) values
    ('${N1}', '${JOB}', '${START}', '00000000-0000-4000-8000-0000000000c1', 'ready', '{"fields_version":"registry-table5-guide-v1.2"}'),
    ('${N2}', '${JOB}', '${START}', null, 'configuration_required', '{}');
  create table public.veec_lodgements(id uuid primary key default gen_random_uuid(), job_id uuid not null unique, status text not null default 'not_submitted', quantity numeric, submission_reference text, submitted_date date, notes text, updated_at timestamptz not null default now());
  insert into public.veec_lodgements(job_id) values ('${JOB2}');
`);
const shim = postgrestShim(db, { jsonColumns: { workflow_events: ["details"], esc_notifications: ["payload_json", "response"] } });
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: shim }));
let consentChecks = 0;
mock.module("../src/lib/esc.server", () => ({ assertCanSubmit: async () => { consentChecks++; } }));
let prestartRuns: string[] = [];
mock.module("../src/lib/prestart.server", () => ({ runPrestart: async (_j: string, t: string) => { prestartRuns.push(t); }, latestNotices: async () => ({ current: null, previousSent: null }) }));
mock.module("../src/lib/autoadvance.server", () => ({ autoAdvanceJob: async () => null }));
const { recordRobotAttempt, recordRobotFailure, recordRobotNotificationSubmitted, recordRobotVeecSubmitted, openRobotFailureRows } = await import("../src/lib/esc-registry-robot.server");
const events = async (job: string) => (await db.query<{ event_type: string; details: Record<string, unknown>; internal: boolean }>("select event_type, details, internal from public.workflow_events where job_id = $1 order by created_at, id", [job])).rows;
const notice = async (id: string) => (await db.query<Record<string, unknown>>("select * from public.esc_notifications where id = $1", [id])).rows[0]!;

describe("install notification record", () => {
  test("attempt first, then the submission lands like an office record, with the office event name", async () => {
    await recordRobotAttempt({ jobId: JOB, task: "install_notification", notificationId: N1, mode: "live", plan: "submit: ready" });
    await recordRobotNotificationSubmitted({ notificationId: N1, reference: "VEU-2026-001", sentAt: "2026-10-23T00:00:00Z", screenshotPath: `${JOB}/esc-registry/x.png`, registryUrl: "https://veu.esc.vic.gov.au/ok" });
    const n = await notice(N1);
    expect(n).toMatchObject({ status: "sent", submission_reference: "VEU-2026-001", submission_method: "adapter", submitted_by: null });
    expect(new Date(n["sent_at"] as string).toISOString()).toBe("2026-10-23T00:00:00.000Z");
    expect((n["response"] as { robot: { screenshot_path: string } }).robot.screenshot_path).toBe(`${JOB}/esc-registry/x.png`);
    expect(consentChecks).toBe(1);
    expect(prestartRuns).toEqual(["esc_submitted"]);
    const ev = await events(JOB);
    expect(ev.map((e) => e.event_type)).toEqual(["esc_registry_robot_attempt", "esc_notification_sent"]);
    expect(ev[1]!.details).toMatchObject({ notification_id: N1, submission_reference: "VEU-2026-001", robot: "esc-registry-robot" });
    expect(ev[1]!.internal).toBe(false); // visible in the job history like the office record
  });
  test("a second record for the same notice is refused and changes nothing", async () => {
    await expect(recordRobotNotificationSubmitted({ notificationId: N1, reference: "VEU-OTHER", sentAt: "2026-10-23T01:00:00Z", screenshotPath: null, registryUrl: null })).rejects.toThrow(/already recorded/);
    expect((await notice(N1))["submission_reference"]).toBe("VEU-2026-001");
    expect((await events(JOB)).length).toBe(2);
  });
  test("a notice that is not ready (no consent) is refused; a nonsense reference is refused", async () => {
    await expect(recordRobotNotificationSubmitted({ notificationId: N2, reference: "VEU-2", sentAt: "2026-10-23T00:00:00Z", screenshotPath: null, registryUrl: null })).rejects.toThrow(/configuration required/);
    expect((await notice(N2))["status"]).toBe("configuration_required");
    await expect(recordRobotNotificationSubmitted({ notificationId: N2, reference: "x", sentAt: "2026-10-23T00:00:00Z", screenshotPath: null, registryUrl: null })).rejects.toThrow(/does not look like a reference/);
  });
});

describe("VEEC creation record", () => {
  test("Ready for VEEC + not submitted → submitted lodgement through veec.core, event veec_updated; never twice", async () => {
    await recordRobotVeecSubmitted({ jobId: JOB2, reference: "VEEC-CREATE-9", quantity: 12, submittedDate: "2026-10-20", screenshotPath: null, registryUrl: null });
    const l = (await db.query<Record<string, unknown>>("select status, quantity, submission_reference, submitted_date from public.veec_lodgements where job_id = $1", [JOB2])).rows[0]!;
    expect(l).toMatchObject({ status: "submitted", submission_reference: "VEEC-CREATE-9" });
    expect(Number(l["quantity"])).toBe(12);
    expect((await events(JOB2)).map((e) => e.event_type)).toEqual(["veec_updated"]);
    await expect(recordRobotVeecSubmitted({ jobId: JOB2, reference: "VEEC-CREATE-10", quantity: 12, submittedDate: "2026-10-20", screenshotPath: null, registryUrl: null })).rejects.toThrow(/already submitted/);
  });
  test("a job that is not Ready for VEEC is refused", async () => {
    await expect(recordRobotVeecSubmitted({ jobId: JOB, reference: "VEEC-CREATE-1", quantity: 1, submittedDate: "2026-10-20", screenshotPath: null, registryUrl: null })).rejects.toThrow(/Ready for VEEC/);
  });
  test("a future submitted date or zero quantity is refused by the shared rules", async () => {
    await db.exec(`insert into public.jobs(id, job_number, stage) values ('00000000-0000-4000-8000-00000000000c', 'HV-3', 'ready_for_veec'); insert into public.veec_lodgements(job_id) values ('00000000-0000-4000-8000-00000000000c');`);
    await expect(recordRobotVeecSubmitted({ jobId: "00000000-0000-4000-8000-00000000000c", reference: "VEEC-X", quantity: 0, submittedDate: "2026-10-20", screenshotPath: null, registryUrl: null })).rejects.toThrow(/greater than 0/);
    await expect(recordRobotVeecSubmitted({ jobId: "00000000-0000-4000-8000-00000000000c", reference: "VEEC-X", quantity: 3, submittedDate: "2999-01-01", screenshotPath: null, registryUrl: null })).rejects.toThrow(/future/);
    expect((await db.query<{ status: string }>("select status from public.veec_lodgements where job_id = $1", ["00000000-0000-4000-8000-00000000000c"])).rows[0]!.status).toBe("not_submitted");
  });
});

describe("failure → Needs me row until done by hand", () => {
  test("a failure is open; recording the notice as sent clears it; a VEEC failure clears once lodged", async () => {
    const N3 = "00000000-0000-4000-8000-0000000000e3";
    await db.exec(`insert into public.esc_notifications(id, job_id, scheduled_start, consent_id, status) values ('${N3}', '${JOB}', '${START}', '00000000-0000-4000-8000-0000000000c1', 'ready')`);
    await recordRobotFailure({ jobId: JOB, task: "install_notification", notificationId: N3, mode: "live", step: "login", error: "The Registry refused the login", screenshotPath: null, registryUrl: null });
    const rows = await openRobotFailureRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ jobId: JOB, task: "install_notification", text: expect.stringContaining("Registry robot failed · ESC notice · login") });
    expect((await events(JOB)).at(-1)!.details).toMatchObject({ needs_office: true, notification_id: N3 });
    expect(await openRobotFailureRows([JOB2])).toEqual([]);
    // Office recorded it by hand (or a later robot run on a fresh version) → row gone.
    await db.exec(`update public.esc_notifications set status = 'sent', sent_at = now(), submission_reference = 'VEU-BY-HAND', submission_method = 'manual_portal' where id = '${N3}'`);
    expect(await openRobotFailureRows()).toEqual([]);
    await recordRobotFailure({ jobId: JOB2, task: "veec_creation", notificationId: null, mode: "live", step: "fill:veec_quantity", error: "no field", screenshotPath: null, registryUrl: null });
    expect(await openRobotFailureRows()).toEqual([]); // JOB2's VEEC is already submitted above
  });
});
