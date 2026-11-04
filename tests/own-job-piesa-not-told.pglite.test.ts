// Part 2 final review: while the office "to book" email wording is held (not approved), a hand-over is silent, so ONE
// office item per hand-over says the installer wasn't told. The 'to book' flag is now approved (Jo 3 Nov 2026), so the held path is exercised by switching the flag off here.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { needsCandidates } from "../src/lib/office-needs.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text);
CREATE VIEW job_overview AS SELECT id, 'HV-1'::text AS job_number, '1 Example St, Clayton 3168'::text AS property_address FROM jobs;
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp());
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), ELEC = id(2), J = id(101);
await db.query(`insert into businesses values ($1,'Reinsulate','Reinsulate','office@reinsulate.test',null,null), ($2,'Sparky Co','Sparky Co',null,'0411111111',null)`, [INST, ELEC]);
await db.query("insert into jobs values ($1,'piesa_and_install_window_pending',null,$2,'installer_sourced','real')", [J, INST]);
await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [J, ELEC, id(11)]);
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true }));
const realLink = await import("../src/lib/own-job-electrician-link.core");
mock.module("../src/lib/own-job-electrician-link.core", () => ({ ...realLink, OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED: false }));
const realOwn = await import("../src/lib/own-job-piesa.server");
mock.module("../src/lib/own-job-piesa.server", () => ({ ...realOwn, ownJobCallAndBook: async () => true }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWorkflow, logEvent: async (job: string, _a: unknown, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,$2,$3,$4,true)", [job, type, summary, JSON.stringify(details ?? {})]); } }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => null }));
const { sendOwnJobPiesaNotices } = await import("../src/lib/own-job-piesa-notices.server");
const items = async () => (await db.query<{ details: Record<string, unknown> }>("select details from workflow_events where job_id=$1 and event_type='own_job_piesa_installer_not_told'", [J])).rows;

describe("installer not told yet", () => {
  test("a held 'to book' email logs ONE office item per hand-over, however many times the notices are retried", async () => {
    expect(await sendOwnJobPiesaNotices(J)).toContain("email: not_approved");
    await sendOwnJobPiesaNotices(J);
    await sendOwnJobPiesaNotices(J);
    const rows = await items();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.details).toMatchObject({ needs_office: true, installer: "Reinsulate", address: "1 Example St, Clayton 3168" });
  });
  test("a new hand-over (new assignment) gets its own item", async () => {
    await db.query("update job_assignments set active=false where job_id=$1", [J]);
    await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [J, ELEC, id(12)]);
    await sendOwnJobPiesaNotices(J);
    expect(await items()).toHaveLength(2);
  });
  test("the Needs row says to call the installer and book it", () => {
    const c = needsCandidates({ jobId: "j", ownJobInstallerNotTold: { at: "2026-11-03T00:00:00Z", installer: "Reinsulate", address: "1 Example St, Clayton 3168" } } as never, Date.parse("2026-11-03T01:00:00Z"));
    const row = c.find((x) => x.kind === "own_job_installer_not_told")!;
    expect(row.line).toBe("Installer not told yet — message wording not approved; call Reinsulate to book the safety check for 1 Example St, Clayton 3168");
    expect(row.group).toBe("today");
    expect(needsCandidates({ jobId: "j" } as never, Date.parse("2026-11-03T01:00:00Z")).some((x) => x.kind === "own_job_installer_not_told")).toBe(false);
  });
});
