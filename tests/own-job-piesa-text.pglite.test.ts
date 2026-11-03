// Part 2 Task 3: the electrician's text path. The link is minted ONLY when the text can go; a held text mints nothing;
// a missing link table holds the text while the office email still goes. sms.server is stubbed at its two seams.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text, piesa_booked_by text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text);
CREATE VIEW job_overview AS SELECT id, 'HV-1'::text AS job_number, '1 Example St, Clayton 3168'::text AS property_address FROM jobs;
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, mobile text, removed_at timestamptz);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp());
CREATE TABLE sms_messages (id uuid primary key default gen_random_uuid(), idempotency_key text, status text);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), ELEC = id(2), J = id(101), J2 = id(102);
await db.query(`insert into businesses values ($1,'Reinsulate','Reinsulate','office@reinsulate.test',null,null,'electrician'), ($2,'Sparky Co','Sparky Co',null,'0411111111',null,null)`, [INST, ELEC]);
await db.query("insert into partner_workers (business_id, profile_id, mobile) values ($1,$2,'0411111111')", [ELEC, id(11)]);
for (const j of [J, J2]) {
  await db.query("insert into jobs values ($1,'piesa_and_install_window_pending',null,$2,'installer_sourced','real')", [j, INST]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [j, ELEC, id(11)]);
}
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
const realCore = await import("../src/lib/electrician-link.core");
mock.module("../src/lib/electrician-link.core", () => ({ ...realCore, OWN_JOB_PIESA_TO_BOOK_EMAIL_APPROVED: true }));
const realOwn = await import("../src/lib/own-job-piesa.server");
mock.module("../src/lib/own-job-piesa.server", () => ({ ...realOwn, ownJobCallAndBook: async () => true }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({ ...realWorkflow, logEvent: async (job: string, _a: unknown, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,$2,$3,$4,true)", [job, type, summary, JSON.stringify(details ?? {})]); } }));
const pauseCalls: unknown[] = [];
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async (o: unknown) => { pauseCalls.push(o); return null; } }));
const emails: { pauseJobId: unknown; record: unknown }[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { pauseJobId: unknown; record: unknown }) => { emails.push(p); return { status: "sent" }; } }));
let hold: string | null = null;
let smsResult = "sent";
const smsCalls: { type: string; businessId: string; jobId: string; body: string; idempotencyKey: string }[] = [];
mock.module("../src/lib/sms.server", () => ({
  smsHoldReason: async () => hold,
  sendRealSms: async (i: (typeof smsCalls)[number]) => { smsCalls.push(i); return { status: smsResult, detail: "", sid: null }; },
}));
const { sendOwnJobPiesaNotices } = await import("../src/lib/own-job-piesa-notices.server");
const links = async (j: string) => (await db.query<{ revoked_at: string | null }>("select revoked_at from electrician_job_links where job_id=$1", [j])).rows;

describe("electrician text path", () => {
  test("missing link table: the text is held (no throw), the office email still goes with the recipient and job for the pause check", async () => {
    const out = await sendOwnJobPiesaNotices(J);
    expect(out).toContain("text: held");
    expect(out).toContain("email: sent");
    expect(smsCalls).toHaveLength(0);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ pauseJobId: J, record: { businessId: INST } });
    expect(pauseCalls).toContainEqual({ businessId: INST, jobId: J });
  });

  test("table now exists; a held text (quiet hours) mints no link and sends nothing", async () => {
    await db.exec(`CREATE TABLE electrician_job_links (id uuid primary key default gen_random_uuid(), job_id uuid, electrician_business_id uuid, token_hash text unique, created_at timestamptz default now(), expires_at timestamptz, revoked_at timestamptz, revoked_reason text);`);
    hold = "quiet hours";
    expect(await sendOwnJobPiesaNotices(J)).toContain("text: held: quiet hours");
    expect(await links(J)).toHaveLength(0);
    expect(smsCalls).toHaveLength(0);
  });

  test("when the text can go: one link minted, one send to the electrician's business with the job", async () => {
    hold = null;
    expect(await sendOwnJobPiesaNotices(J)).toContain("text: sent");
    expect(await links(J)).toEqual([{ revoked_at: null }]);
    expect(smsCalls).toHaveLength(1);
    expect(smsCalls[0]).toMatchObject({ type: "own_job_piesa_link", businessId: ELEC, jobId: J });
    expect(smsCalls[0]!.body).toMatch(/\/e\/[A-Za-z0-9_-]{40,}/);
  });

  test("a text that was already sent is not sent again and mints no second link", async () => {
    await db.query("insert into sms_messages (idempotency_key, status) values ($1,'sent')", [smsCalls[0]!.idempotencyKey]);
    expect(await sendOwnJobPiesaNotices(J)).toContain("text: already");
    expect(smsCalls).toHaveLength(1);
    expect(await links(J)).toHaveLength(1);
  });

  test("a text the sender then refuses has its link switched off", async () => {
    smsResult = "blocked";
    await sendOwnJobPiesaNotices(J2);
    const l = await links(J2);
    expect(l).toHaveLength(1);
    expect(l[0]!.revoked_at).not.toBeNull();
  });
});
