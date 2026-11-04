// Part 2 Task 3 (carried decision a): sendOwnJobPiesaNotices owns its retry — one key per assignment and channel, safe to
// call again and again. Booker defaults to "office" here (column not applied), so only the office email is in play.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text);
CREATE VIEW job_overview AS SELECT id, 'HV-1'::text AS job_number, '1 Example St, Clayton 3168'::text AS property_address FROM jobs;
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp());
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), ELEC = id(2), J = id(101), J_BOOKED = id(102), J_QA = id(103), J_OFF = id(104);
await db.query(`insert into businesses values ($1,'Reinsulate','Reinsulate','office@reinsulate.test',null,null), ($2,'Sparky Co','Sparky Co',null,'0411111111',null)`, [INST, ELEC]);
for (const j of [J, J_BOOKED, J_QA, J_OFF]) {
  await db.query("insert into jobs values ($1,'piesa_and_install_window_pending',null,$2,'installer_sourced',$3)", [j, INST, j === J_QA ? "qa_test" : "real"]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id, booking_confirmed_at) values ($1,'electrician',$2,$3,$4)", [j, ELEC, id(11), j === J_BOOKED ? new Date().toISOString() : null]);
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
let commsOn = true;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn, hasCurrentOwnerContactConsent: async () => true }));
const realCore = await import("../src/lib/own-job-electrician-link.core");
mock.module("../src/lib/own-job-electrician-link.core", () => ({ ...realCore, OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED: true }));
const realOwn = await import("../src/lib/own-job-piesa.server");
mock.module("../src/lib/own-job-piesa.server", () => ({ ...realOwn, ownJobCallAndBook: async () => true }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWorkflow, logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,true)", [job, actor, type, summary, JSON.stringify(details ?? {})]); } }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => null }));
let failNext = false;
const sent: string[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { subject: string }) => { if (failNext) { failNext = false; return { status: "failed", detail: "The email service refused this address or message" }; } sent.push(p.subject); return { status: "sent" }; } }));

const { sendOwnJobPiesaNotices } = await import("../src/lib/own-job-piesa-notices.server");

describe("notices retry", () => {
  test("a failed office email is retried by the next call, then sent once only", async () => {
    failNext = true;
    expect(await sendOwnJobPiesaNotices(J)).toContain("email: not_sent");
    expect(sent).toHaveLength(0);
    expect(await sendOwnJobPiesaNotices(J)).toContain("email: sent");
    expect(sent).toEqual(["Safety check to book for 1 Example St, Clayton 3168"]);
    await sendOwnJobPiesaNotices(J);
    await sendOwnJobPiesaNotices(J);
    expect(sent).toHaveLength(1);
  });
  test("a job already booked sends nothing", async () => {
    expect(await sendOwnJobPiesaNotices(J_BOOKED)).toBe("booked");
    expect(sent).toHaveLength(1);
  });
  test("a TEST job never emails a real installer office", async () => {
    const before = sent.length;
    expect(await sendOwnJobPiesaNotices(J_QA)).toContain("email: not_sent");
    expect(sent).toHaveLength(before);
  });
  test("master switch off: held before the claim, so turning it on sends it once", async () => {
    commsOn = false;
    const before = sent.length;
    expect(await sendOwnJobPiesaNotices(J_OFF)).toContain("email: held");
    expect(sent).toHaveLength(before);
    commsOn = true;
    expect(await sendOwnJobPiesaNotices(J_OFF)).toContain("email: sent");
    expect(sent).toHaveLength(before + 1);
  });
});
