// "Pause all trade messages" (Jo 30 Oct 2026) at the shared senders, on a practice Postgres (PGlite): no live database,
// no Twilio, no email service.
// - sendRealSms: partner texts held (recorded "blocked", key NOT claimed); owner texts and sign-in codes still go;
//   unpaused → the same key sends exactly once.
// Jo 31 Oct: only a business with messages_while_paused=true gets office/partner emails while paused.
// - sendOfficeEmail: partner/applicant emails held and recorded; homeowner + Jo's TEST inbox unchanged.
// - representative paths: job offer (text + email), team member invite (text). Install tomorrow runs its REAL path in
//   trade-pause-install-tomorrow.test.ts.
import { beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { HELD_KEY_MARK } from "../src/lib/sms.core";

setSystemTime(new Date("2026-10-22T02:00:00Z")); // 1pm Melbourne: outside SMS quiet hours

const BIZ = "11111111-1111-1111-1111-111111111111";
const JOB = "22222222-2222-2222-2222-222222222222";
const OFFER = "33333333-3333-3333-3333-333333333333";
const INVITE = "44444444-4444-4444-4444-444444444444";

const db = new PGlite();
await db.exec(`create schema auth; create function auth.uid() returns uuid language sql as 'select null::uuid'; create role anon; create role authenticated; create role service_role;
  create function public.has_role(uuid, text) returns boolean language sql as 'select false';
  create table public.workflow_settings(id int primary key, daily_mitti_text_enabled boolean not null default false, updated_at timestamptz not null default now()); insert into public.workflow_settings(id) values (1);
  create table public.jobs(id uuid primary key, source text, channel text, deleted_at timestamptz);
  create table public.businesses(id uuid primary key, name text, trading_name text, email text, signer_email text, signer_name text, signer_mobile text, phone text, is_active boolean, approved_at timestamptz, onboarding_notes text);
  create table public.partner_offers(id uuid primary key, job_id uuid, business_id uuid, kind text, status text, summary jsonb, offered_at timestamptz, expires_at timestamptz);
  create table public.partner_worker_invites(id uuid primary key, business_id uuid, expires_at timestamptz, used_at timestamptz, revoked_at timestamptz);
  create table public.workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default now());
  create table public.admin_config_events(id uuid primary key default gen_random_uuid(), actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
  create table public.job_communications(id uuid primary key default gen_random_uuid(), job_id uuid, direction text, channel text, recipients text[], subject text, body text, provider text, sent_at timestamptz, delivery_status text, visibility text, source_event text, source_reference text);
  insert into public.businesses values ('${BIZ}', 'Acme Insulation', null, 'boss@acme.example', null, 'Sam Boss', '0412 345 678', null, true, now(), null);
  insert into public.jobs values ('${JOB}', 'website', 'hivic_sourced', null);
  insert into public.partner_offers values ('${OFFER}', '${JOB}', '${BIZ}', 'ready_check', 'pending', '{"suburb":"Preston","area_m2":80}', now(), now() + interval '1 day');
  insert into public.partner_worker_invites values ('${INVITE}', '${BIZ}', now() + interval '14 days', null, null);`);
await db.exec(readFileSync("docs/pending-migrations/0141_real_sms_sender.sql", "utf8"));
await db.exec(readFileSync("docs/pending-migrations/trade-messages-paused.sql", "utf8"));
await db.exec(readFileSync("docs/pending-migrations/business-messages-while-paused.sql", "utf8"));
const TOM = "55555555-5555-5555-5555-555555555555";
await db.exec(`insert into public.businesses(id, name, email, is_active, approved_at, messages_while_paused) values ('${TOM}', 'Tom Electrical', 'tom@tom.example', true, now(), true)`);
await db.exec(`update public.workflow_settings set sms_message_switches = '{"job_offer":true,"team_member_invite":true,"install_tomorrow":true,"swms_sign_link":true,"quote_ready":true,"owner_code":true}' where id = 1`);

const twilio: string[] = [];
const emails: { to: string; subject: string }[] = [];
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db, { jsonColumns: { workflow_settings: ["sms_message_switches"], admin_config_events: ["details"], workflow_events: ["details"], partner_offers: ["summary"] } }) }));
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true }));
mock.module("../src/lib/twilio-au1.server", () => ({
  au1Configured: () => true,
  au1SendMessage: async (p: URLSearchParams) => { twilio.push(p.get("Body") ?? ""); return { ok: true, status: 201, text: JSON.stringify({ sid: `SM${twilio.length}` }) }; },
}));
mock.module("../src/lib/workflow.server", () => ({
  logEvent: async (jobId: string, actorId: string | null, eventType: string, summary: string, details: Record<string, unknown> = {}, opts: { internal?: boolean } = {}) => {
    await db.query("insert into public.workflow_events(job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,$6)", [jobId, actorId, eventType, summary, JSON.stringify(details), opts.internal ?? false]);
  },
}));
globalThis.fetch = (async (_url: string, init: { body: string }) => {
  const b = JSON.parse(init.body) as { to: string[]; subject: string };
  emails.push({ to: b.to[0]!, subject: b.subject });
  return new Response(JSON.stringify({ id: `em${emails.length}` }), { status: 200 });
}) as unknown as typeof fetch;
process.env["TWILIO_FROM_NUMBER"] = "+61480000000";
process.env["RESEND_API_KEY"] = "re_test";
process.env["LOVABLE_API_KEY"] = "lv_test";

const { sendRealSms } = await import("../src/lib/sms.server");
const { sendOfficeEmail } = await import("../src/lib/office-email.server");
const { textInstallerAboutOffer, emailInstallerAboutOffer } = await import("../src/lib/ready-check-offer-text.server");
const { textTeamMemberInvite } = await import("../src/lib/installer-texts.server");

const setPaused = (on: boolean) => db.query("update public.workflow_settings set trade_messages_paused = $1 where id = 1", [on]);
const smsRows = async (prefix: string) => (await db.query<{ idempotency_key: string; status: string; detail: string | null }>("select idempotency_key, status, detail from public.sms_messages where idempotency_key like $1 order by created_at, idempotency_key", [`${prefix}%`])).rows;
const officeEmailRecords = async () => (await db.query<{ details: { to: string; status: string; detail: string } }>("select details from public.admin_config_events where event_type = 'office_manual_email' order by created_at, id")).rows.map((r) => r.details);
const nowIso = () => new Date().toISOString();

beforeEach(async () => { await setPaused(true); });

describe("per-business exception (messages_while_paused)", () => {
  test("flagged business gets its email; every other business stays held", async () => {
    emails.length = 0;
    const tom = await sendOfficeEmail({ actorId: null, recipient: "partner", to: "tom@tom.example", contactName: "Tom", subject: "Welcome", message: "Hello", label: "partner_welcome_on_approval", record: { businessId: TOM } });
    const other = await sendOfficeEmail({ actorId: null, recipient: "partner", to: "boss@acme.example", contactName: "Sam", subject: "Welcome", message: "Hello", label: "partner_welcome_on_approval", record: { businessId: BIZ } });
    const noBiz = await sendOfficeEmail({ actorId: null, recipient: "applicant", to: "tom@tom.example", contactName: "Tom", subject: "Hi", message: "Hello", label: "y", record: {} });
    expect(tom.status).toBe("sent");
    expect(other).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    expect(noBiz).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    expect(emails.map((e) => e.to)).toEqual(["tom@tom.example"]);
  });
  test("the flag never lifts the pause for others and the global pause stays on", async () => {
    const { tradeMessagesPausedNow } = await import("../src/lib/trade-pause.server");
    expect(await tradeMessagesPausedNow()).toBe("Trade messages paused");
    expect(await tradeMessagesPausedNow({ businessId: BIZ })).toBe("Trade messages paused");
    expect(await tradeMessagesPausedNow({ businessId: "99999999-9999-9999-9999-999999999999" })).toBe("Trade messages paused");
    expect(await tradeMessagesPausedNow({ businessId: TOM })).toBeNull();
    expect((await db.query<{ p: boolean }>("select trade_messages_paused p from public.workflow_settings where id=1")).rows[0]!.p).toBe(true);
  });
  test("a partner text to the flagged business is still held (emails only)", async () => {
    const r = await sendRealSms({ type: "swms_sign_link", idempotencyKey: "swms-sign:v1:tom", to: "0412 000 111", body: "x", jobId: JOB, businessId: TOM });
    expect(r).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
  });
});

