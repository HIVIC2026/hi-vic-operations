// Jo 23 Oct 2026: installer jobs get their Mitti Ready Check form automatically on the 15-minute tick.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { AUTOFORM_ENABLED, AUTOFORM_MAX_PER_TICK, autoFormDecision, isStageFailure, type AutoFormFacts } from "../src/lib/mitti-autoform.core";

const now = new Date("2026-10-23T09:00:00Z");
const ok: AutoFormFacts = {
  channel: "installer_sourced", stage: "ready_check_ready_to_schedule", createdAt: "2026-10-23T06:33:00Z", deleted: false, archived: false,
  hasCurrentMeasurement: false, installerUserId: "u1", mittiInvited: true, templateSet: true, autoSendMitti: true, lastFailureAt: null,
};

describe("autoFormDecision", () => {
  test("a fresh bulk-uploaded installer job with no form gets one", () => expect(autoFormDecision(ok, now, true)).toEqual({ action: "create" }));
  test.each([
    [{ channel: "hivic_sourced" }, "HIV lead not booked yet"],
    [{ channel: "website" }, "not an installer job or HIV lead"],
    [{ deleted: true }, "removed"],
    [{ stage: "measured_quote_accepted" }, "past the Ready Check"],
    [{ createdAt: "2026-09-01T00:00:00Z" }, "older than 30 days"],
    [{ hasCurrentMeasurement: true }, "already has a Ready Check record"],
    [{ autoSendMitti: false }, "automatic Mitti forms are switched off"],
    [{ templateSet: false }, "Ready Check form not set up"],
    [{ mittiInvited: false }, "installer not set up in Mitti"],
    [{ installerUserId: null }, "no installer assigned"],
    [{ lastFailureAt: "2026-10-23T08:00:00Z" }, "last attempt failed – retrying tomorrow"],
  ] as [Partial<AutoFormFacts>, string][])("skips %o", (over, reason) => expect(autoFormDecision({ ...ok, ...over }, now, true)).toEqual({ action: "skip", reason }));
  test("a failure more than a day old is retried", () => expect(autoFormDecision({ ...ok, lastFailureAt: "2026-10-22T08:00:00Z" }, now, true).action).toBe("create"));
  // Jo 24 Oct (HV-3151): Add a job / Add one job / Upload jobs can leave an installer job in any pre-Ready-Check stage
  // (the website checks parked HV-3151 at "estimate sent"); the form is made there, and a stage refusal never waits a day.
  test("an installer job in any pre-Ready-Check stage gets its form (HV-3151 sat at 'estimate sent')", () => {
    for (const stage of ["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule", "ready_check_scheduled"])
      expect(autoFormDecision({ ...ok, stage }, now, true)).toEqual({ action: "create" });
  });
  test("a stage refusal an hour ago is retried on the next tick; a Mitti error an hour ago still waits a day", () => {
    const stageReason = "Mitti assessments can only be created once the job is waiting on or has booked its PIESA.";
    expect(isStageFailure(stageReason)).toBe(true);
    expect(isStageFailure("Mitti user not found for info@example.test")).toBe(false);
    expect(autoFormDecision({ ...ok, lastFailureAt: "2026-10-23T08:00:00Z", lastFailureReason: stageReason }, now, true)).toEqual({ action: "create" });
    expect(autoFormDecision({ ...ok, lastFailureAt: "2026-10-23T08:00:00Z", lastFailureReason: "Mitti user not found for info@example.test" }, now, true)).toEqual({ action: "skip", reason: "last attempt failed – retrying tomorrow" });
  });
  // Jo 24 Oct (HV-3151/HV-3164): "I've visited" on Add a job leaves only a provisional size, which gives way to the form.
  test("a visited job's provisional size waits two hours for the installer's own form, then gets one", () => {
    const visited = { ...ok, hasCurrentMeasurement: true, provisionalOnly: true };
    expect(autoFormDecision({ ...visited, createdAt: "2026-10-23T08:00:00Z" }, now, true)).toEqual({ action: "skip", reason: "waiting in case the installer started his own form" });
    expect(autoFormDecision(visited, now, true)).toEqual({ action: "create" });
  });
});

// HV-3542 (Jo 30 Oct): HIV website leads get their form from the backup too, but only once the Ready Check is booked.
describe("autoFormDecision for HIV leads", () => {
  const lead: AutoFormFacts = { ...ok, channel: "hivic_sourced", stage: "ready_check_scheduled", bookedAt: "2026-10-22T09:00:00Z" };
  test("a booked HIV lead with no form gets one", () => expect(autoFormDecision(lead, now, true)).toEqual({ action: "create" }));
  test("an HIV lead with no booking, or at an earlier stage, is skipped", () => {
    expect(autoFormDecision({ ...lead, bookedAt: null }, now, true)).toEqual({ action: "skip", reason: "HIV lead not booked yet" });
    expect(autoFormDecision({ ...lead, stage: "ready_check_ready_to_schedule" }, now, true)).toEqual({ action: "skip", reason: "HIV lead not booked yet" });
  });
  test("the 30 days count from the booking, not the enquiry", () => {
    expect(autoFormDecision({ ...lead, createdAt: "2026-08-24T09:00:00Z" }, now, true)).toEqual({ action: "create" });
    expect(autoFormDecision({ ...lead, createdAt: "2026-08-24T09:00:00Z", bookedAt: "2026-09-22T09:00:00Z" }, now, true)).toEqual({ action: "skip", reason: "older than 30 days" });
  });
  test("an HIV lead whose form is already made is skipped", () => {
    expect(autoFormDecision({ ...lead, hasCurrentMeasurement: true }, now, true)).toEqual({ action: "skip", reason: "already has a Ready Check record" });
    expect(autoFormDecision({ ...lead, hasCurrentMeasurement: true, provisionalOnly: true }, now, true)).toEqual({ action: "skip", reason: "already has a Ready Check record" });
  });
  test("the same switches, installer and back-off checks apply", () => {
    expect(autoFormDecision({ ...lead, autoSendMitti: false }, now, true)).toEqual({ action: "skip", reason: "automatic Mitti forms are switched off" });
    expect(autoFormDecision({ ...lead, installerUserId: null }, now, true)).toEqual({ action: "skip", reason: "no installer assigned" });
    expect(autoFormDecision({ ...lead, lastFailureAt: "2026-10-23T08:00:00Z" }, now, true)).toEqual({ action: "skip", reason: "last attempt failed – retrying tomorrow" });
  });
});

// ---- sweep against real rows (PGlite), Mitti mocked ----
const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, job_number text, channel text, source text, stage text, created_at timestamptz, deleted_at timestamptz, qa_archived_at timestamptz, originating_installer_business_id uuid);
CREATE TABLE workflow_settings (id int, auto_send_mitti boolean, mitti_ready_check_priced_template_id text);
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean, provenance text, status text default 'draft', external_source text, accepted_by uuid);
CREATE TABLE job_assignments (job_id uuid, user_id uuid, business_id uuid, role text, active boolean);
CREATE TABLE businesses (id uuid, mitti_account_invited boolean, onboarding_notes text);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, created_at timestamptz);`);
const REAL = "00000000-0000-0000-0000-0000000000b1", TESTB = "00000000-0000-0000-0000-0000000000b2", U = "00000000-0000-0000-0000-0000000000c1";
const j = (n: number) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
await db.exec(`INSERT INTO workflow_settings VALUES (1, true, 'template_a1');
INSERT INTO businesses VALUES ('${REAL}', true, null), ('${TESTB}', true, '[TEST PARTNER] practice');
INSERT INTO jobs VALUES
 ('${j(1)}','HV-3136','installer_sourced','bulk_import','ready_check_ready_to_schedule','2026-10-23T06:33:00Z',null,null,'${REAL}'),
 ('${j(2)}','HV-3137','installer_sourced','bulk_import','ready_check_ready_to_schedule','2026-10-23T06:33:00Z',null,null,'${REAL}'),
 ('${j(3)}','HV-3116','installer_sourced','installer_mitti','ready_check_scheduled','2026-10-23T03:00:00Z',null,null,'${REAL}'),
 ('${j(4)}','HV-0001','hivic_sourced','base44','ready_check_ready_to_schedule','2026-10-23T03:00:00Z',null,null,null),
 ('${j(5)}','HV-3121','installer_sourced','installer_mitti','ready_check_ready_to_schedule','2026-10-23T03:12:00Z',null,null,'${TESTB}'),
 ('${j(6)}','HV-3099','installer_sourced','bulk_import','ready_check_ready_to_schedule','2026-10-23T03:00:00Z','2026-10-23T04:00:00Z',null,'${REAL}'),
 ('${j(7)}','HV-3151','installer_sourced','installer_import','preliminary_estimate_ready','2026-10-23T05:00:00Z',null,null,'${REAL}'),
 ('${j(8)}','HV-3542','hivic_sourced','website','ready_check_scheduled','2026-08-01T00:00:00Z',null,null,null),
 ('${j(9)}','HV-3543','hivic_sourced','website','ready_check_scheduled','2026-10-20T00:00:00Z',null,null,null);
-- HV-3542: an HIV website lead (old enquiry) booked yesterday with no form; HV-3543 has only a cancelled booking.
INSERT INTO bookings (job_id, kind, status, created_at) VALUES ('${j(8)}','ready_check','confirmed','2026-10-22T09:30:00Z'), ('${j(9)}','ready_check','cancelled','2026-10-22T09:30:00Z'), ('${j(4)}','assessment','confirmed','2026-10-22T09:30:00Z');
INSERT INTO ceiling_measurements (job_id, is_current) VALUES ('${j(3)}', true);
INSERT INTO job_assignments VALUES ('${j(1)}','${U}','${REAL}','installer',true), ('${j(2)}','${U}','${REAL}','installer',true), ('${j(3)}','${U}','${REAL}','installer',true), ('${j(5)}','${U}','${TESTB}','installer',true), ('${j(6)}','${U}','${REAL}','installer',true), ('${j(7)}','${U}','${REAL}','installer',true), ('${j(8)}','${U}','${REAL}','installer',true), ('${j(9)}','${U}','${REAL}','installer',true);
-- HV-3151 as it was live on 23 Oct: the website checks parked it at "estimate sent" and the tick's attempt was refused by the stage guard 10 minutes ago.
INSERT INTO workflow_events (job_id, event_type, summary, details, created_at) VALUES ('${j(7)}', 'mitti_autoform_failed', 'Mitti Ready Check form could not be created automatically', '{"needs_office": true, "reason": "Mitti assessments can only be created once the job is waiting on or has booked its PIESA."}', '2026-10-23T08:50:00Z');`);

mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/workflow.server", () => ({
  WorkflowError: class extends Error {},
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
class MittiClaimHeld extends Error {}
class MittiOutcomeUncertain extends Error {}
mock.module("../src/lib/mitti-create.server", () => ({ MittiClaimHeld, MittiOutcomeUncertain }));
const calls: { jobId: string; opts: { readyCheck?: boolean; assignee?: { email: string } } }[] = [];
mock.module("../src/lib/mitti.server", () => ({
  realMittiCall: async () => { throw new Error("no network in tests"); },
  createAssignMittiAudit: async (jobId: string, _actor: string | null, _call: unknown, opts: { readyCheck?: boolean; assignee?: { email: string } }) => {
    calls.push({ jobId, opts });
    if (jobId === j(2)) throw new Error("Mitti user not found for info@example.test");
    await db.query("insert into ceiling_measurements (job_id, is_current) values ($1, true)", [jobId]);
    return { auditId: `audit_${jobId}`, reused: false, scope: "MEASURE_UP_ONLY" };
  },
}));
const holds: string[] = [];
mock.module("../src/lib/mitti-pickup.server", () => ({ holdAtMittiReadyCheck: async (jobId: string) => { holds.push(jobId); return true; } }));
const { sweepReadyCheckForms } = await import("../src/lib/mitti-autoform.server");

describe("sweepReadyCheckForms", () => {
  test("switched on; when paused it creates nothing", async () => {
    expect(AUTOFORM_ENABLED).toBe(true);
    expect(autoFormDecision(ok, now, false)).toEqual({ action: "skip", reason: "automatic Ready Check forms are paused" });
    const r = await sweepReadyCheckForms({ now, enabled: false });
    expect([r.results, r.wouldCreate, calls.length]).toEqual([[], [], 0]);
  });

  test("dry run lists exactly the installer jobs and booked HIV leads that still need a form", async () => {
    const r = await sweepReadyCheckForms({ now, dryRun: true, enabled: true });
    // HV-3542: booked HIV lead found; HV-3543 (cancelled booking) and HV-0001 (not booked) left out.
    expect(r.wouldCreate.sort()).toEqual(["HV-3121", "HV-3136", "HV-3137", "HV-3151", "HV-3542"]); // HV-3151: stage refusal 10 min ago is no reason to wait a day
    expect(calls).toHaveLength(0);
  });

  test("creates forms through the guarded create path; TEST partner jobs go only to the TEST Mitti account; failures flag the office once", async () => {
    const r = await sweepReadyCheckForms({ now, enabled: true });
    expect(Object.fromEntries(r.results.map((x) => [x.jobNumber, x.outcome]))).toEqual({ "HV-3121": "created", "HV-3136": "created", "HV-3137": "failed", "HV-3151": "created", "HV-3542": "created" });
    expect(calls.every((c) => c.opts.readyCheck === true)).toBe(true);
    expect(calls.find((c) => c.jobId === j(5))!.opts.assignee!.email).toBe("jo@actpropertyinspections.com.au");
    expect(calls.find((c) => c.jobId === j(1))!.opts.assignee).toBeUndefined();
    expect(calls.find((c) => c.jobId === j(8))!.opts.assignee).toBeUndefined(); // a real HIV lead goes to the real installer
    expect(holds.sort()).toEqual([j(1), j(5), j(7), j(8)].sort()); // made forms wait on the installer (HV-3151 leaves "estimate sent"); the failed one is untouched
    const { rows } = await db.query<{ n: number; needs: boolean; kind: string }>("select count(*)::int n, bool_and((details->>'needs_office')::boolean) needs, min(details->>'kind') kind from workflow_events where event_type = 'mitti_autoform_failed' and job_id = $1", [j(2)]);
    expect(rows[0]).toEqual({ n: 1, needs: true, kind: "mitti" }); // a Mitti error: backs off for a day
  });

  test("the next tick creates nothing new and does not retry the failure for a day", async () => {
    calls.length = 0;
    await db.query("update workflow_events set created_at = $1 where event_type = 'mitti_autoform_failed'", [now.toISOString()]); // pin to the test clock
    const r = await sweepReadyCheckForms({ now: new Date(now.getTime() + 15 * 60_000), enabled: true });
    expect(r.results).toEqual([]);
    expect(calls).toHaveLength(0);
    const later = await sweepReadyCheckForms({ now: new Date(now.getTime() + 25 * 3_600_000), dryRun: true, enabled: true });
    expect(later.wouldCreate).toEqual(["HV-3137"]);
  });

  test("wired into the 15-minute tick, never sends to owners; stage only via the shared Mitti hold", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain("sweepReadyCheckForms()");
    expect(tick.indexOf("sweepReadyCheckForms()")).toBeLessThan(tick.indexOf("syncPendingMitti(null)")); // before the slower Mitti work
    expect(tick.indexOf("sweepMittiPickupAuto()")).toBeLessThan(tick.indexOf("sweepReadyCheckForms()")); // installer's own form linked first
    expect(AUTOFORM_MAX_PER_TICK).toBe(5); // inside the tick's 55s limit
    const src = readFileSync("src/lib/mitti-autoform.server.ts", "utf8");
    expect(src).not.toMatch(/sendRealSms|sendMessage|transition\(|\.update\(/);
    expect(src).toContain("holdAtMittiReadyCheck(j.id, null)"); // installer jobs wait on the installer once the form exists
  });
});

test("installers aren't offered a blank 'New Ready Check' form anywhere (blank forms aren't linked to a job)", () => {
  for (const f of ["src/routes/_authenticated/field.index.tsx", "src/routes/_authenticated/partner.import.tsx", "src/routes/_authenticated/field.$jobId.tsx"]) expect(readFileSync(f, "utf8")).not.toContain("<NewReadyCheckButton");
  expect(readFileSync("src/components/trade/new-ready-check.tsx", "utf8")).toContain("please don't start a new form in Mitti");
});
