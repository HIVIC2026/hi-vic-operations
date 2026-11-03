// "Pause all trade messages" (Jo 30 Oct 2026) at the shared senders, on a practice Postgres (PGlite): no live database,
// no Twilio, no email service.
// - sendRealSms: partner texts held (recorded "blocked", key NOT claimed); owner texts and sign-in codes still go;
//   unpaused → the same key sends exactly once.
// - sendOfficeEmail: partner/applicant emails held and recorded; homeowner + Jo's TEST inbox unchanged.
// - representative paths: job offer (text + email), team member invite (text). Install tomorrow runs its REAL path in
//   trade-pause-install-tomorrow.test.ts.
import { beforeAll, beforeEach, describe, expect, mock, setSystemTime, test } from "bun:test";
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
const JOB_F = "66666666-6666-6666-6666-666666666666";
const OFFER_P = "77777777-7777-7777-7777-777777777777";
await db.exec(`insert into public.businesses(id, name, email, signer_mobile, is_active, approved_at, messages_while_paused) values ('${TOM}', 'Tom Electrical', 'tom@tom.example', '0412 000 111', true, now(), true);
  alter table public.jobs add column originating_installer_business_id uuid;
  create table public.partner_relationships(id uuid primary key default gen_random_uuid(), installer_business_id uuid, electrician_business_id uuid, active boolean not null default true);
  create table public.job_assignments(id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, role text, active boolean not null default true);
  create table public.appointment_proposals(id uuid primary key default gen_random_uuid(), job_id uuid, piesa_window_round int, status text, starts_at timestamptz);
  insert into public.jobs(id, source, channel, originating_installer_business_id) values ('${JOB_F}', 'website', 'hivic_sourced', '${TOM}');
  insert into public.partner_offers values ('${OFFER_P}', '${JOB}', '${TOM}', 'piesa', 'pending', '{"suburb":"Preston","job_number":"HIV-1","approx_area_m2":80,"electrician_rate_inc_gst":300}', now(), now() + interval '1 day');`);
await db.exec(`update public.workflow_settings set sms_message_switches = '{"piesa_offer":true,"daily_mitti":true,"job_offer":true,"team_member_invite":true,"install_tomorrow":true,"swms_sign_link":true,"quote_ready":true,"owner_code":true}' where id = 1`);

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
const { textElectricianAboutOffer, emailElectricianAboutOffer } = await import("../src/lib/trade-messages.server");

await db.exec("update public.workflow_settings set daily_mitti_text_enabled = true where id = 1");
const setPaused = (on: boolean) => db.query("update public.workflow_settings set trade_messages_paused = $1 where id = 1", [on]);
const smsRows = async (prefix: string) => (await db.query<{ idempotency_key: string; status: string; detail: string | null }>("select idempotency_key, status, detail from public.sms_messages where idempotency_key like $1 order by created_at, idempotency_key", [`${prefix}%`])).rows;
const officeEmailRecords = async () => (await db.query<{ details: { to: string; status: string; detail: string } }>("select details from public.admin_config_events where event_type = 'office_manual_email' order by created_at, id")).rows.map((r) => r.details);
const nowIso = () => new Date().toISOString();

beforeEach(async () => { await setPaused(true); });

describe("sendRealSms while paused", () => {
  test("partner text held (recorded, key not claimed) → unpaused → same key sends once", async () => {
    const input = { type: "swms_sign_link" as const, idempotencyKey: "swms-sign:v1:b1", to: "0412 345 678", body: "Sign the safety plan", jobId: JOB, businessId: BIZ };
    const held = await sendRealSms(input);
    expect(held).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    const r = await smsRows("swms-sign:v1:b1");
    expect(r).toHaveLength(1);
    expect(r[0]!.status).toBe("blocked");
    expect(r[0]!.idempotency_key).toContain(HELD_KEY_MARK);
    expect(r[0]!.detail).toBe("Trade messages paused");
    expect(twilio).toHaveLength(0);

    await setPaused(false);
    expect((await sendRealSms(input)).status).toBe("sent");
    expect((await sendRealSms(input)).status).toBe("already");
    expect(twilio).toHaveLength(1);
  });

  test("owner text and sign-in code still go while paused", async () => {
    const before = twilio.length;
    expect(await sendRealSms({ type: "quote_ready", idempotencyKey: "quote-ready:v1:q1", to: "0400 111 222", body: "Your quote is ready", jobId: JOB, event: { at: nowIso(), current: true } })).toMatchObject({ status: "sent" });
    expect(await sendRealSms({ type: "owner_code", idempotencyKey: "owner-code:v1:c1", to: "0400 111 222", body: "Your code is 123456", jobId: JOB, event: { at: nowIso(), current: true } })).toMatchObject({ status: "sent" });
    expect(twilio.length).toBe(before + 2);
  });
});

describe("sendOfficeEmail while paused", () => {
  test("partner and applicant emails held and recorded; nothing reaches the email service", async () => {
    const before = emails.length;
    const p = await sendOfficeEmail({ actorId: null, recipient: "partner", to: "boss@acme.example", contactName: "Sam", subject: "Hi", message: "Hello", label: "x", record: { businessId: BIZ } });
    const a = await sendOfficeEmail({ actorId: null, recipient: "applicant", to: "new@trade.example", contactName: "Al", subject: "Hi", message: "Hello", label: "y", record: {} });
    expect(p).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    expect(a).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    expect(emails.length).toBe(before);
    const recs = await officeEmailRecords();
    expect(recs.slice(-2).map((d) => [d.to, d.status, d.detail]).sort()).toEqual([["boss@acme.example", "blocked", "Trade messages paused"], ["new@trade.example", "blocked", "Trade messages paused"]]);
  });

  test("homeowner email keeps its own rule; Jo's TEST inbox still sends while paused; unpaused partner email sends", async () => {
    const before = emails.length;
    // Office typed emails to owners were already refused by officeEmailBlocker; the pause never applies to them.
    expect((await sendOfficeEmail({ actorId: null, recipient: "homeowner", to: "owner@home.example", contactName: "Pat", subject: "Hi", message: "Hello", label: "z", record: {} })).detail).toBe("Owner emails stay behind the sending switches.");
    expect((await sendOfficeEmail({ actorId: null, recipient: "partner", to: "jolowexo@hotmail.com", contactName: "Jo", subject: "Hi", message: "Hello", label: "t", record: {} })).status).toBe("sent");
    await setPaused(false);
    expect((await sendOfficeEmail({ actorId: null, recipient: "partner", to: "boss@acme.example", contactName: "Sam", subject: "Hi", message: "Hello", label: "x", record: { businessId: BIZ } })).status).toBe("sent");
    expect(emails.length).toBe(before + 2);
  });
});

describe("representative trade paths while paused", () => {
  test("job offer: text and email held; the email's once-only event is not written; unpaused → both go", async () => {
    const t0 = twilio.length, e0 = emails.length;
    expect(await textInstallerAboutOffer(OFFER)).toBe("blocked: Trade messages paused");
    expect(await emailInstallerAboutOffer(OFFER)).toBe("held: Trade messages paused");
    const ev = await db.query("select 1 from public.workflow_events where event_type = 'ready_check_offer_email'");
    expect(ev.rows).toHaveLength(0);
    expect(twilio.length).toBe(t0);
    expect(emails.length).toBe(e0);

    await setPaused(false);
    expect(await textInstallerAboutOffer(OFFER)).toMatch(/^sent/);
    expect(await emailInstallerAboutOffer(OFFER)).toMatch(/^sent/);
    expect(twilio.length).toBe(t0 + 1);
    expect(emails.length).toBe(e0 + 1);
  });

  test("team member invite: text held, then sent once unpaused", async () => {
    const t0 = twilio.length;
    const held = await textTeamMemberInvite({ inviteId: INVITE, businessId: BIZ, mobile: "0412 999 888", token: "tok123", createdAt: nowIso() });
    expect(held).toEqual({ status: "not_sent", detail: "Trade messages paused" });
    expect(twilio.length).toBe(t0);
    await setPaused(false);
    expect((await textTeamMemberInvite({ inviteId: INVITE, businessId: BIZ, mobile: "0412 999 888", token: "tok123", createdAt: nowIso() })).status).toBe("sent");
    expect(twilio.length).toBe(t0 + 1);
  });
});

describe("flagged business: senders pass their ids (Jo 31 Oct)", () => {
  test("job_only_check_for_flagged_job_lifts", async () => {
    // Recipient business unknown (job id only): the job's flagged originating installer lifts it. (A real partner text
    // always carries its business id, so this is checked on the pause read itself.)
    const { tradeMessagesPausedNow } = await import("../src/lib/trade-pause.server");
    expect(await tradeMessagesPausedNow({ jobId: JOB_F })).toBeNull();
  });
  test("partner_text_flagged_job_unflagged_recipient_held", async () => {
    // Narrowed 3 Nov: a known, unflagged and unlinked recipient is NOT lifted by the job's flagged installer.
    const r = await sendRealSms({ type: "swms_sign_link", idempotencyKey: "swms-sign:v1:flagged-job-other", to: "0412 345 678", body: "Sign the safety plan", jobId: JOB_F, businessId: BIZ });
    expect(r).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
  });
  test("partner_text_for_flagged_business_sends", async () => {
    const r = await sendRealSms({ type: "swms_sign_link", idempotencyKey: "swms-sign:v1:flagged-biz", to: "0412 000 111", body: "Sign the safety plan", jobId: JOB, businessId: TOM });
    expect(r.status).toBe("sent");
  });
  test("partner_text_unflagged_held", async () => {
    const r = await sendRealSms({ type: "swms_sign_link", idempotencyKey: "swms-sign:v1:unflagged", to: "0412 345 678", body: "Sign the safety plan", jobId: JOB, businessId: BIZ });
    expect(r).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
  });
  test("partner_text_no_ids_held", async () => {
    const r = await sendRealSms({ type: "swms_sign_link", idempotencyKey: "swms-sign:v1:noids", to: "0412 345 678", body: "Sign the safety plan" });
    expect(r).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
  });
  test("piesa_offer_text_flagged_sends", async () => {
    const t0 = twilio.length;
    const r = await textElectricianAboutOffer(OFFER_P);
    expect(r).not.toMatch(/^held/);
    expect(r).toMatch(/^electrician sms sent/);
    expect(twilio.length).toBe(t0 + 1);
  });
  test("digest_first_job_flagged_for_unflagged_trade_held", async () => {
    // A daily Mitti digest covers several jobs: its first job (flagged originating installer) must not lift the hold for the unflagged trade.
    const digest = { type: "daily_mitti" as const, to: "0412 345 678", body: "Good morning! Your jobs today", jobId: JOB_F, businessId: BIZ };
    // Narrowed 3 Nov: with the recipient business known the job no longer lifts it either way.
    expect(await sendRealSms({ ...digest, idempotencyKey: "daily-mitti:digest-old" })).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    const r = await sendRealSms({ ...digest, idempotencyKey: "daily-mitti:digest-new", pauseByBusinessOnly: true });
    expect(r).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    const { readFileSync: read } = await import("node:fs");
    expect(read("src/lib/daily-mitti-text.server.ts", "utf8")).toContain("pauseByBusinessOnly: true");
  });
});

describe("email path matches the sender's own check (no claim burned)", () => {
  const JOB_X = "88888888-0000-0000-0000-000000000001";
  const ELEC = "88888888-0000-0000-0000-000000000002";
  const OFFER_X = "88888888-0000-0000-0000-000000000003", OFFER_E = "88888888-0000-0000-0000-000000000004", OFFER_EX = "88888888-0000-0000-0000-000000000005";
  const summary = '{"suburb":"Preston","job_number":"HIV-2","approx_area_m2":80,"electrician_rate_inc_gst":300}';
  beforeAll(() => db.exec(`insert into public.businesses(id, name, email, signer_mobile, is_active, approved_at) values ('${ELEC}', 'Peter Electrical', 'peter@elec.example', '0412 222 333', true, now());
    insert into public.jobs(id, source, channel, originating_installer_business_id) values ('${JOB_X}', 'website', 'hivic_sourced', '${BIZ}');
    insert into public.partner_relationships(installer_business_id, electrician_business_id, active) values ('${TOM}', '${ELEC}', true), ('${BIZ}', '${ELEC}', true);
    insert into public.partner_offers values ('${OFFER_X}', '${JOB_F}', '${BIZ}', 'piesa', 'pending', '${summary}', now(), now() + interval '1 day'),
      ('${OFFER_E}', '${JOB_F}', '${ELEC}', 'piesa', 'pending', '${summary}', now(), now() + interval '1 day'),
      ('${OFFER_EX}', '${JOB_X}', '${ELEC}', 'piesa', 'pending', '${summary}', now(), now() + interval '1 day');`));
  const claims = async (offerId: string) => (await db.query("select 1 from public.workflow_events where event_type = 'electrician_offer_email' and details->>'offer_id' = $1", [offerId])).rows.length;

  test("unflagged, unlinked electrician offered a flagged installer's job: text and email both HELD, nothing claimed", async () => {
    const t0 = twilio.length, e0 = emails.length;
    expect(await textElectricianAboutOffer(OFFER_X)).toBe("held: Trade messages paused");
    expect(await emailElectricianAboutOffer(OFFER_X)).toBe("held: Trade messages paused");
    expect(await claims(OFFER_X)).toBe(0);
    expect(twilio.length).toBe(t0);
    expect(emails.length).toBe(e0);
  });
  test("sendOfficeEmail with the sender's ids agrees with the sender's own check", async () => {
    const { tradeMessagesPausedNow } = await import("../src/lib/trade-pause.server");
    const e0 = emails.length;
    // flagged job + unlinked recipient: both held
    expect(await tradeMessagesPausedNow({ jobId: JOB_F, businessId: BIZ })).toBe("Trade messages paused");
    expect(await sendOfficeEmail({ actorId: null, recipient: "partner", to: "boss@acme.example", contactName: null, subject: "S", message: "M", label: "x", record: { businessId: BIZ }, pauseJobId: JOB_F })).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    // linked electrician on X's job: business-only would lift it, the job id keeps it held — same answer as the check
    expect(await tradeMessagesPausedNow({ businessId: ELEC })).toBeNull();
    expect(await tradeMessagesPausedNow({ jobId: JOB_X, businessId: ELEC })).toBe("Trade messages paused");
    expect(await sendOfficeEmail({ actorId: null, recipient: "partner", to: "peter@elec.example", contactName: null, subject: "S", message: "M", label: "x", record: { businessId: ELEC }, pauseJobId: JOB_X })).toMatchObject({ status: "blocked", detail: "Trade messages paused" });
    expect(emails.length).toBe(e0);
  });
  test("linked electrician on the flagged installer's job: claim written AND email sent", async () => {
    const e0 = emails.length;
    expect(await emailElectricianAboutOffer(OFFER_E)).toMatch(/^electrician email sent/);
    expect(await claims(OFFER_E)).toBe(1);
    expect(emails.length).toBe(e0 + 1);
  });
  test("linked electrician on an unflagged installer's job: held before the claim", async () => {
    const e0 = emails.length;
    expect(await emailElectricianAboutOffer(OFFER_EX)).toBe("held: Trade messages paused");
    expect(await claims(OFFER_EX)).toBe(0);
    expect(emails.length).toBe(e0);
  });
});
