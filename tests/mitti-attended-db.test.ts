// finishMittiReadyCheck marks an installer job Attended = Yes once (PGlite; the rest of the pipeline is off via enabled:false).
import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE jobs (id uuid primary key, channel text, installer_site_check text, installer_site_check_date date);`);
const J1 = "00000000-0000-0000-0000-000000000001", J2 = "00000000-0000-0000-0000-000000000002", J3 = "00000000-0000-0000-0000-000000000003", J_LEAD = "00000000-0000-0000-0000-000000000004";
await db.query("insert into jobs values ($1,'installer_sourced','no',null),($2,'installer_sourced','no',null),($3,'installer_sourced',null,null),($4,'hivic_sourced','no',null)", [J1, J2, J3, J_LEAD]);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
const { finishMittiReadyCheck } = await import("../src/lib/mitti-complete.server");

const run = (job: string, enabled: boolean, ourLead = false) => finishMittiReadyCheck(job, { auditId: "A1", completed: true, modifiedAt: "2026-10-27T21:17:53.631Z", entries: [], ourLead, enabled });
const row = async (job: string) => (await db.query<{ c: string | null; d: string | null }>("select installer_site_check c, to_char(installer_site_check_date,'YYYY-MM-DD') d from jobs where id=$1", [job])).rows[0]!;
const events = async (job: string) => (await db.query<{ n: number }>("select count(*)::int n from workflow_events where event_type='installer_attended_from_mitti' and job_id=$1", [job])).rows[0]!.n;

describe("finished Mitti Ready Check → Attended Yes", () => {
  test("complete: yes + Melbourne date + ONE event", async () => {
    await run(J1, false);
    expect(await row(J1)).toEqual({ c: "yes", d: "2026-10-28" });
    expect(await events(J1)).toBe(1);
  });
  test("hand-set to no, run again: stays no, still ONE event", async () => {
    await db.query("update jobs set installer_site_check='no' where id=$1", [J1]);
    await run(J1, false);
    expect((await row(J1)).c).toBe("no");
    expect(await events(J1)).toBe(1);
  });
  test("preparation switched off (enabled:false): still yes", async () => {
    await run(J2, false);
    expect((await row(J2)).c).toBe("yes");
    expect(await events(J2)).toBe(1);
  });
  test("an unset answer becomes yes too", async () => {
    await run(J3, false);
    expect((await row(J3)).c).toBe("yes");
  });
  test("our own lead (hivic_sourced) is unchanged", async () => {
    await run(J_LEAD, false, true);
    expect(await row(J_LEAD)).toEqual({ c: "no", d: null });
    expect(await events(J_LEAD)).toBe(0);
  });
  test("written before the switch-off return, and never throws out", () => {
    const src = readFileSync("src/lib/mitti-complete.server.ts", "utf8");
    expect(src.indexOf("mittiAttendedPatch")).toBeGreaterThan(0);
    expect(src.indexOf("mittiAttendedPatch")).toBeLessThan(src.indexOf("if (!enabled)"));
  });
});
