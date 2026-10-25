// Decision 172: the one-off "3 questions" reminder sends each enquiry ONCE, through the real guarded owner email path
// and the one real SMS sender, against a real Postgres engine (PGlite). Providers are counting fakes; nothing leaves.
import { beforeAll, expect, mock, test, setSystemTime } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

// Environment: these texts honour the 8pm–7am Melbourne quiet hours (Jo 22 Oct 2026). Pin the clock to 1pm Melbourne on
// today's date so the result never depends on when the suite runs.
{ const midday = new Date(); midday.setUTCHours(2, 0, 0, 0); setSystemTime(midday); }


const db = new PGlite();
let emails = 0, texts = 0;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
mock.module("../src/lib/twilio-au1.server", () => ({ au1Configured: () => true, au1SendMessage: async () => { texts++; return { ok: true, status: 201, text: '{"sid":"SM-test"}' }; } }));
mock.module("../src/lib/hot-leads-send.server", () => ({ resendSend: async () => { emails++; return { outcome: "accepted", id: "re-test", detail: "Accepted" }; } }));
mock.module("../src/lib/comms-test-recipient.core", () => ({ testRecipientBoundary: () => ({ status: "inactive", restricted: false }) }));

const JOB_A = "00000000-0000-4000-8000-0000000000a1", JOB_B = "00000000-0000-4000-8000-0000000000b1", JOB_C = "00000000-0000-4000-8000-0000000000c1";
const PROP_A = "00000000-0000-4000-8000-0000000000e1", PROP_B = "00000000-0000-4000-8000-0000000000e2", PROP_C = "00000000-0000-4000-8000-0000000000e3";
const TOKEN = (c: string) => c.repeat(43);
const SCEN = JSON.stringify([{ by_access: { standard: { estimated_customer_total: 3716.24, applied_discount: 1610, pre_discount_total: 5198 } } }]);
const SNAP = JSON.stringify({ settings: { piesa_assessment_inc_gst: 349, ap_management_inc_gst: 349 }, scenarios: [{ by_access: { standard: { installation: 4500 } } }] });
const ANSWERED = JSON.stringify({ owner_insulation_details: { answers: { insulation_type: "batts", insulation_thickness: "thin", insulation_coverage: "partial" }, route: "likely_save_spot" } });

beforeAll(async () => {
  process.env["TWILIO_FROM_NUMBER"] = "+61491567890";
  await db.exec(`
    create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid';
    create role authenticated; create role service_role;
    create function public.has_role(uuid,text) returns boolean language sql as 'select false';
    create table public.workflow_settings(id int primary key, customer_comms_enabled boolean not null default false, daily_mitti_text_enabled boolean not null default false);
    insert into public.workflow_settings(id, customer_comms_enabled) values (1, true);
    create table public.businesses(id uuid primary key);
    create table public.properties(id uuid primary key, address_line text, suburb text, postcode text, enrichment jsonb);
    create table public.jobs(id uuid primary key, property_id uuid references public.properties(id), job_number text, source text, estimated_area_m2 numeric, estimated_area_unknown boolean default false, deleted_at timestamptz);
    create table public.office_enquiry_index(id uuid primary key, job_number text, created_at timestamptz, source text, stage text, eligibility_outcome text, removed boolean, deleted_at timestamptz, owner_name text, owner_email text, owner_phone text, spot_saved boolean, contact_rank int);
    create table public.indicative_estimates(id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), status text, scenarios jsonb, area_source text, area_m2 numeric, insulation_declared text, snapshot jsonb);
    create table public.customer_estimate_links(id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), token text unique, purpose text, status text, expires_at timestamptz, created_at timestamptz default now());
    create table public.customer_email_optouts(id uuid primary key default gen_random_uuid(), job_id uuid not null unique references public.jobs(id), token text not null unique, opted_out_at timestamptz, created_at timestamptz default now());
    create table public.lead_campaign_responses(job_id uuid primary key references public.jobs(id), opted_out_at timestamptz);
    create table public.customer_engagement_events(id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), event_type text);
    create table public.customer_email_sends(id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), purpose text not null, idempotency_key text not null unique, status text not null default 'sending', provider text, provider_message_id text, error text, created_at timestamptz default now(), sent_at timestamptz);
    create table public.owner_contact_consents(id uuid primary key default gen_random_uuid(), job_id uuid references public.jobs(id), consent_status text, created_at timestamptz default now());
    create table public.job_communications(id uuid primary key default gen_random_uuid(), job_id uuid, direction text, channel text, recipients text[], subject text, body text, provider text, sent_at timestamptz, delivery_status text, visibility text, source_event text, source_reference text);
    create table public.retail_estimator_settings(id uuid primary key default gen_random_uuid(), is_current boolean, removal_inc_gst_per_m2 numeric);
    insert into public.retail_estimator_settings(is_current, removal_inc_gst_per_m2) values (true, 15);
  `);
  await db.exec(readFileSync("docs/pending-migrations/0141_real_sms_sender.sql", "utf8"));
  const home = async (job: string, prop: string, n: string, created: string, email: string, phone: string, enrichment: string | null) => {
    await db.query(`insert into public.properties(id, address_line, suburb, postcode, enrichment) values ($1,'1 Test St','Reservoir','3073',$2::jsonb)`, [prop, enrichment]);
    await db.query(`insert into public.jobs(id, property_id, job_number, source, estimated_area_m2, estimated_area_unknown) values ($1,$2,$3,'base44',150,true)`, [job, prop, n]);
    await db.query(`insert into public.office_enquiry_index values ($1,$2,$3,'base44','preliminary_estimate_ready','likely_eligible',false,null,'Helen Smith',$4,$5,false,1)`, [job, n, created, email, phone]);
    await db.query(`insert into public.indicative_estimates(job_id, status, scenarios, area_source, area_m2, insulation_declared, snapshot) values ($1,'current',$2::jsonb,'typical_default',150,'unknown',$3::jsonb)`, [job, SCEN, SNAP]);
    await db.query(`insert into public.customer_estimate_links(job_id, token, purpose, status, expires_at) values ($1,$2,'step3_estimate','active', now() + interval '10 days')`, [job, TOKEN(n.slice(-1))]);
    await db.query(`insert into public.owner_contact_consents(job_id, consent_status) values ($1,'granted')`, [job]);
  };
  await home(JOB_A, PROP_A, "HV-1", "2026-10-20T04:00:00Z", "helen@example.com", "0491234567", null);        // reminded
  await home(JOB_B, PROP_B, "HV-2", "2026-10-19T04:00:00Z", "bob@example.com", "0491234568", ANSWERED);      // already answered
  await home(JOB_C, PROP_C, "HV-3", "2026-10-23T04:00:00Z", "cat@example.com", "0491234569", null);          // after the cutoff
});

const { runThreeQuestionsReminder } = await import("../src/lib/three-questions-reminder.server");
const count = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0]!.n;

test("dry run plans one reminder, explains every skip, and writes nothing", async () => {
  const r = await runThreeQuestionsReminder(true, null);
  expect(r.sendBlockers).toEqual([]);
  expect(r.recipientCount).toBe(1);
  expect(r.samples[0]).toMatchObject({ jobNumber: "HV-1", email: "helen@example.com", phone: "0491234567" });
  expect(r.samples[0]?.subject).toContain("Helen");
  expect(r.samples[0]?.smsBody).toBe(`Hi Helen, 3 quick questions and your $1,610 rebate spot is saved: https://estimate.homeinsulationvictoria.com.au/estimate/${TOKEN("1")}/video Reply STOP to opt out.`);
  expect(r.skipped.map((s) => [s.jobNumber, s.reason])).toEqual([["HV-2", "Already answered the 3 questions"]]);
  expect(await count("select count(*)::int n from public.customer_email_sends")).toBe(0);
  expect(await count("select count(*)::int n from public.sms_messages")).toBe(0);
  expect(emails + texts).toBe(0);
});

test("send delivers the email and the text once through the guarded senders and records both", async () => {
  const r = await runThreeQuestionsReminder(false, null);
  expect(r.results).toEqual([{ jobId: JOB_A, jobNumber: "HV-1", email: "sent", sms: "sent: Twilio AU1 accepted" }]);
  expect(emails).toBe(1); expect(texts).toBe(1);
  const sends = await db.query<{ purpose: string; idempotency_key: string; status: string }>("select purpose, idempotency_key, status from public.customer_email_sends");
  expect(sends.rows).toEqual([{ purpose: "three_questions_reminder", idempotency_key: `three-questions-reminder:v1:${JOB_A}`, status: "sent" }]);
  const sms = await db.query<{ message_type: string; idempotency_key: string; status: string; body: string }>("select message_type, idempotency_key, status, body from public.sms_messages");
  expect(sms.rows).toEqual([{ message_type: "three_questions_reminder", idempotency_key: `three-questions-reminder-sms:v1:${JOB_A}`, status: "sent", body: expect.stringMatching(/^Home Insulation Victoria: Hi Helen, 3 quick questions/) }]);
});

test("a second run reminds nobody again (the recorded send and claim exclude the home), even if the records disagree", async () => {
  const again = await runThreeQuestionsReminder(false, null);
  expect(again.recipientCount).toBe(0);
  expect(again.skipped.find((s) => s.jobNumber === "HV-1")?.reason).toBe("Already sent this reminder (no repeat)");
  // Even with the email record gone, the SMS claim still fences the home; and the unique keys fence the senders themselves.
  await db.query("delete from public.customer_email_sends");
  expect((await runThreeQuestionsReminder(false, null)).recipientCount).toBe(0);
  expect(emails).toBe(1); expect(texts).toBe(1);
});

test("the master switch blocks a send and the dry run says so", async () => {
  await db.query("update public.workflow_settings set customer_comms_enabled = false");
  const r = await runThreeQuestionsReminder(true, null);
  expect(r.sendBlockers).toEqual(["Customer communications master switch is off (unchanged)"]);
  await expect(runThreeQuestionsReminder(false, null)).rejects.toThrow(/master switch is off/);
  await db.query("update public.workflow_settings set customer_comms_enabled = true");
});

test("a TEST copy only ever runs for a qa_test job", async () => {
  await expect(runThreeQuestionsReminder(false, null, "HV-1")).rejects.toThrow("TEST sends use TEST jobs only.");
  await expect(runThreeQuestionsReminder(false, null, "HV-999")).rejects.toThrow("TEST sends use TEST jobs only.");
});
