// Jo 23 Oct 2026: installer jobs get their Mitti Ready Check form automatically on the 15-minute tick.
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { AUTOFORM_ENABLED, AUTOFORM_MAX_PER_TICK, autoFormDecision, type AutoFormFacts } from "../src/lib/mitti-autoform.core";

const now = new Date("2026-10-23T09:00:00Z");
const ok: AutoFormFacts = {
  channel: "installer_sourced", stage: "ready_check_ready_to_schedule", createdAt: "2026-10-23T06:33:00Z", deleted: false, archived: false,
  hasCurrentMeasurement: false, installerUserId: "u1", mittiInvited: true, templateSet: true, autoSendMitti: true, lastFailureAt: null,
};

describe("autoFormDecision", () => {
  test("a fresh bulk-uploaded installer job with no form gets one", () => expect(autoFormDecision(ok, now, true)).toEqual({ action: "create" }));
  test.each([
    [{ channel: "hivic_sourced" }, "not an installer job"],
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
});

// ---- sweep against real rows (PGlite), Mitti mocked ----
const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, job_number text, channel text, source text, stage text, created_at timestamptz, deleted_at timestamptz, qa_archived_at timestamptz, originating_installer_business_id uuid);
CREATE TABLE workflow_settings (id int, auto_send_mitti boolean, mitti_ready_check_priced_template_id text);
CREATE TABLE ceiling_measurements (id uuid primary key default gen_random_uuid(), job_id uuid, is_current boolean);
CREATE TABLE job_assignments (job_id uuid, user_id uuid, business_id uuid, role text, active boolean);
CREATE TABLE businesses (id uuid, mitti_account_invited boolean, onboarding_notes text);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());`);
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
 ('${j(6)}','HV-3099','installer_sourced','bulk_import','ready_check_ready_to_schedule','2026-10-23T03:00:00Z','2026-10-23T04:00:00Z',null,'${REAL}');
INSERT INTO ceiling_measurements (job_id, is_current) VALUES ('${j(3)}', true);
INSERT INTO job_assignments VALUES ('${j(1)}','${U}','${REAL}','installer',true), ('${j(2)}','${U}','${REAL}','installer',true), ('${j(3)}','${U}','${REAL}','installer',true), ('${j(5)}','${U}','${TESTB}','installer',true), ('${j(6)}','${U}','${REAL}','installer',true);`);

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
const { sweepReadyCheckForms } = await import("../src/lib/mitti-autoform.server");

describe("sweepReadyCheckForms", () => {
  test("switched on; when paused it creates nothing", async () => {
    expect(AUTOFORM_ENABLED).toBe(true);
    expect(autoFormDecision(ok, now, false)).toEqual({ action: "skip", reason: "automatic Ready Check forms are paused" });
    const r = await sweepReadyCheckForms({ now, enabled: false });
    expect([r.results, r.wouldCreate, calls.length]).toEqual([[], [], 0]);
  });

  test("dry run lists exactly the installer jobs that still need a form", async () => {
    const r = await sweepReadyCheckForms({ now, dryRun: true, enabled: true });
    expect(r.wouldCreate.sort()).toEqual(["HV-3121", "HV-3136", "HV-3137"]);
    expect(calls).toHaveLength(0);
  });

  test("creates forms through the guarded create path; TEST partner jobs go only to the TEST Mitti account; failures flag the office once", async () => {
    const r = await sweepReadyCheckForms({ now, enabled: true });
    expect(Object.fromEntries(r.results.map((x) => [x.jobNumber, x.outcome]))).toEqual({ "HV-3121": "created", "HV-3136": "created", "HV-3137": "failed" });
    expect(calls.every((c) => c.opts.readyCheck === true)).toBe(true);
    expect(calls.find((c) => c.jobId === j(5))!.opts.assignee!.email).toBe("jo@actpropertyinspections.com.au");
    expect(calls.find((c) => c.jobId === j(1))!.opts.assignee).toBeUndefined();
    const { rows } = await db.query<{ n: number; needs: boolean }>("select count(*)::int n, bool_and((details->>'needs_office')::boolean) needs from workflow_events where event_type = 'mitti_autoform_failed' and job_id = $1", [j(2)]);
    expect(rows[0]).toEqual({ n: 1, needs: true });
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

  test("wired into the 15-minute tick, never sends to owners or changes stage", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain("sweepReadyCheckForms()");
    expect(tick.indexOf("sweepReadyCheckForms()")).toBeLessThan(tick.indexOf("syncPendingMitti(null)")); // before the slower Mitti work
    expect(AUTOFORM_MAX_PER_TICK).toBe(5); // inside the tick's 55s limit
    const src = readFileSync("src/lib/mitti-autoform.server.ts", "utf8");
    expect(src).not.toMatch(/sendRealSms|sendMessage|transition\(|\.update\(/);
  });
});
