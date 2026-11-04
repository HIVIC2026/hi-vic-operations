// Part 3 Task 5 (Jo 3 Nov 2026): the upgrades day and certificate chases on real rows (PGlite). The REAL sweeps, facts
// (jobCertificateFacts / currentCoes), link senders (textUpgradesDayLink / textCertificateLink) and electrician links run;
// stubbed at their seams: the text sender (records each text once per key, like sms_messages' unique key), the installer
// office email (records each key once, like deliverOnce), the trade pause and the comms switch.
// Review Focus 1: no upgrades day → day 1 text, day 2 email, then the red flag at 7 days left; nothing twice.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { A3_REPAIR_NEEDED_LABEL, A3_UPGRADES_TODAY_LABEL, CERTIFICATE_NOW_LABEL, SHORT_PIESA_FIELDS } from "../src/lib/official-short.core";
import { PIESA_EVIDENCE_BY_ID } from "../src/lib/piesa-evidence.core";
import { CERTIFICATE_CHASE_ROUND_EVENT, CERTIFICATE_CHASE_SENT_EVENT, CHASE_ROUND } from "../src/lib/certificate-chase.core";
import { SMS_MESSAGE_TYPES } from "../src/lib/sms.core";

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text, job_number text, created_at timestamptz default clock_timestamp());
CREATE VIEW job_overview AS SELECT id, job_number, '1 Example St, Clayton 3168'::text AS property_address FROM jobs;
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, profile_id uuid, full_legal_name text, mobile text, removed_at timestamptz);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp());
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz, business_id uuid, created_at timestamptz default clock_timestamp());
CREATE TABLE electrician_job_links (id uuid primary key default gen_random_uuid(), job_id uuid, electrician_business_id uuid, token_hash text unique, created_at timestamptz default now(), expires_at timestamptz, revoked_at timestamptz, revoked_reason text);
CREATE TABLE assessments (id uuid primary key default gen_random_uuid(), job_id uuid, mitti_raw_snapshot jsonb, completed_at timestamptz);
CREATE TABLE piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, outcome text, completed_date date, is_current boolean default true, created_at timestamptz default clock_timestamp());
create unique index if not exists piesa_current_uq on piesa_records(job_id) where is_current;
CREATE TABLE evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, category text);
CREATE TABLE evidence_files (id uuid primary key default gen_random_uuid(), requirement_id uuid, job_id uuid, storage_path text, mime_type text, uploaded_at timestamptz default clock_timestamp());
CREATE TABLE documents (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, title text, storage_path text, mime_type text, external_id text, source_system text, created_at timestamptz default clock_timestamp());
CREATE TABLE rectification_items (id uuid primary key default gen_random_uuid(), job_id uuid, description text, status text);
CREATE TABLE sms_messages (id uuid primary key default gen_random_uuid(), idempotency_key text unique, status text);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST = id(1), ELEC = id(2), U1 = id(11), U_INST = id(12);
await db.query(`insert into businesses values ($1,'Reinsulate','Reinsulate','office@reinsulate.test','0300000000',null), ($2,'Sparky Co','Sparky Co',null,'0499999999',null)`, [INST, ELEC]);
await db.query(`insert into partner_workers (business_id, profile_id, full_legal_name, mobile) values ($1,$2,'Sparky Sam','0411111111')`, [ELEC, U1]);
const label = (fid: string) => SHORT_PIESA_FIELDS.find((f) => f.id === fid)!.label;
const snapshot = (today: "Yes" | "No", certNow?: "Yes" | "No") => [
  { label: A3_REPAIR_NEEDED_LABEL, value: "Yes" }, { label: A3_UPGRADES_TODAY_LABEL, value: today },
  ...(certNow ? [{ label: CERTIFICATE_NOW_LABEL, value: certNow }] : []),
  { label: label("coesNumber"), value: null }, { label: label("certDate"), value: null },
  { label: PIESA_EVIDENCE_BY_ID.ces_file.label, value: null, media: [] },
];
// PIESA done Fri 30 Oct 2026, 2pm Melbourne.
const PIESA_AT = "2026-10-30T03:00:00.000Z";
async function seedUpgrades(j: string) {
  await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source, job_number) values ($1,'rectification_scheduling',$2,'installer_sourced','real',$3)", [j, INST, `HV-${j.slice(-3)}`]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [j, ELEC, U1]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'installer',$2,$3)", [j, INST, U_INST]);
  await db.query("insert into assessments (job_id, mitti_raw_snapshot, completed_at) values ($1,$2,$3)", [j, JSON.stringify(snapshot("No")), PIESA_AT]);
  await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, created_at) values ($1,'initial','fail','2026-10-30',$2)", [j, PIESA_AT]);
  await db.query("insert into rectification_items (job_id, description, status) values ($1,'Replace split conduit','required')", [j]);
}
async function seedCertificate(j: string) {
  // The A4 recorded Part C on Mon 2 Nov without the certificate.
  await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source, job_number) values ($1,'installation_scheduling',$2,'installer_sourced','real',$3)", [j, INST, `HV-${j.slice(-3)}`]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [j, ELEC, U1]);
  await db.query("insert into assessments (job_id, mitti_raw_snapshot, completed_at) values ($1,$2,$3)", [j, JSON.stringify(snapshot("Yes", "No")), PIESA_AT]);
  await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, created_at, is_current) values ($1,'initial','fail','2026-10-30',$2,false)", [j, PIESA_AT]);
  await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, created_at) values ($1,'post_rectification','pass','2026-11-02','2026-11-02T03:00:00Z')", [j]);
  await db.query("insert into evidence_requirements (job_id, category) values ($1,'rectification_completion')", [j]);
}
const J_UP = id(301), J_UP_BOOKED = id(302), J_UP_HELD = id(303), J_CERT = id(311), J_CERT_FILE = id(312);
for (const j of [J_UP, J_UP_BOOKED, J_UP_HELD]) await seedUpgrades(j);
for (const j of [J_CERT, J_CERT_FILE]) await seedCertificate(j);
// J_UP_BOOKED: the electrician entered the day on Mon 2 Nov — nothing is ever chased.
await db.query("insert into bookings (job_id, kind, status, scheduled_start, business_id) values ($1,'rectification','confirmed','2026-11-12T00:00:00Z',$2)", [J_UP_BOOKED, ELEC]);
// J_CERT_FILE: the certificate came in through the link before day 2.
const reqOf = async (j: string) => (await db.query<{ id: string }>("select id from evidence_requirements where job_id=$1", [j])).rows[0]!.id;
await db.query("insert into evidence_files (requirement_id, job_id, storage_path, mime_type) values ($1,$2,'jobs/x/electrician-uploads/abcdefgh.pdf','application/pdf')", [await reqOf(J_CERT_FILE), J_CERT_FILE]);

// Fix 1: every request through the shim is counted (reads AND writes), so the held path's cost per job is measured.
const shim = postgrestShim(db);
let requests = 0;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...shim, from: (t: string) => { requests++; return shim.from(t); } } }));
// The wording gates (fix 1 item 2). The first two blocks run with the wording approved (the send paths); the last block
// puts them back to held, as they are in the code until Jo approves, then flips them.
const realChase = { ...(await import("../src/lib/certificate-chase.core")) };
const setWording = (approved: boolean) => {
  (SMS_MESSAGE_TYPES.electrician_upgrades_day_link as { wordingApproved: boolean }).wordingApproved = approved;
  (SMS_MESSAGE_TYPES.electrician_certificate_link as { wordingApproved: boolean }).wordingApproved = approved;
  mock.module("../src/lib/certificate-chase.core", () => ({ ...realChase, UPGRADES_DAY_OFFICE_EMAIL_APPROVED: approved }));
};
setWording(true);
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => true, hasCurrentOwnerContactConsent: async () => true, assertCustomerDeliveryAllowed: async () => undefined }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => {
    await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details, internal) values ($1,$2,$3,$4,$5,true)", [job, actor, type, summary, JSON.stringify(details ?? {})]);
  },
}));
const pauseCalls: unknown[] = [];
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async (a: unknown) => { pauseCalls.push(a); return null; } }));
// J_UP_HELD: its text is held (wording not approved) from the first tick until the last test lifts the hold.
const held = new Set<string>([J_UP_HELD]);
const texts: { type: string; key: string; body: string; businessId: string; jobId: string }[] = [];
mock.module("../src/lib/sms.server", () => ({
  smsHoldReason: async (i: { jobId: string }) => (held.has(i.jobId) ? "wording not approved" : null),
  sendRealSms: async (i: { type: string; idempotencyKey: string; body: string; businessId: string; jobId: string }) => {
    const r = await db.query("insert into sms_messages (idempotency_key, status) values ($1,'sent') on conflict do nothing returning id", [i.idempotencyKey]);
    if (!r.rows.length) return { status: "already" };
    texts.push({ type: i.type, key: i.idempotencyKey, body: i.body, businessId: i.businessId, jobId: i.jobId });
    return { status: "sent" };
  },
}));
const emails: { jobId: string; businessId: string; key: string; subject: string; text: string; approved: boolean }[] = [];
const realNotices = await import("../src/lib/own-job-piesa-notices.server");
mock.module("../src/lib/own-job-piesa-notices.server", () => ({
  ...realNotices,
  emailInstallerOffice: async (p: { jobId: string; businessId: string; key: string; subject: string; text: string; approved: boolean }) => {
    if (emails.some((e) => e.key === p.key)) return { status: "not_sent", detail: "Already tried." };
    emails.push(p);
    return { status: "sent" };
  },
}));

const chase = await import("../src/lib/certificate-later.server");
const rounds = async (j: string) => (await db.query<{ details: { round: string } }>("select details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [j, CERTIFICATE_CHASE_ROUND_EVENT])).rows.map((r) => r.details.round);
const sentRounds = async (j: string) => (await db.query<{ details: { round: string } }>("select details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [j, CERTIFICATE_CHASE_SENT_EVENT])).rows.map((r) => r.details.round);
const flags = async (j: string) => (await chase.chaseFlagsForJobs([j])).get(j) ?? {};
const textsFor = (j: string) => texts.filter((t) => t.jobId === j);
const emailsFor = (j: string) => emails.filter((e) => e.jobId === j);

describe("upgrades day not entered (Review Focus 1)", () => {
  test("Mon 2 Nov 11pm: still inside day 1 → nothing", async () => {
    await chase.sweepUpgradesDayChase(new Date("2026-11-02T12:00:00Z"));
    expect(textsFor(J_UP)).toEqual([]);
    expect(await rounds(J_UP)).toEqual([]);
  });
  test("Tue 3 Nov (Cup day) 10am: day 1 over → ONE reminder text with the link; held office email not yet", async () => {
    await chase.sweepUpgradesDayChase(new Date("2026-11-02T23:00:00Z"));
    const t = textsFor(J_UP);
    expect(t.length).toBe(1);
    expect(t[0]!.type).toBe("electrician_upgrades_day_link");
    expect(t[0]!.key).toMatch(/^electrician-upgrades-day-link:v1:[0-9a-f-]+:chase-1bd$/);
    expect(t[0]!.body).toMatch(/^Hi Sparky, the upgrades day for 1 Example St, Clayton 3168 isn't booked yet\. Add it here: \S+\/e\/\S+$/);
    expect(t[0]!.businessId).toBe(ELEC);
    expect(emailsFor(J_UP)).toEqual([]);
    expect(await rounds(J_UP)).toEqual([CHASE_ROUND.upgradesText]);
    expect(await sentRounds(J_UP)).toEqual([CHASE_ROUND.upgradesText]);
    expect(await flags(J_UP)).toEqual({});
    // The same tick again: nothing twice.
    await chase.sweepUpgradesDayChase(new Date("2026-11-03T01:00:00Z"));
    expect(textsFor(J_UP).length).toBe(1);
    expect(await rounds(J_UP)).toEqual([CHASE_ROUND.upgradesText]);
  });
  test("Thu 5 Nov 9am: day 2 over → ONE installer office email (held wording) + the week office row", async () => {
    await chase.sweepUpgradesDayChase(new Date("2026-11-04T22:00:00Z"));
    await chase.sweepUpgradesDayChase(new Date("2026-11-04T23:00:00Z"));
    const e = emailsFor(J_UP);
    expect(e.length).toBe(1);
    expect(e[0]).toMatchObject({ businessId: INST, approved: true, subject: "Upgrades day not set — 1 Example St, Clayton 3168" });
    expect(e[0]!.text).toContain("Sparky Sam");
    expect(textsFor(J_UP).length).toBe(1);
    expect(await flags(J_UP)).toMatchObject({ upgradesDayNotSet: { electrician: "Sparky Sam", address: "1 Example St, Clayton 3168" } });
  });
  test("Sun 22 Nov, 7 days left on the 30-day clock → ONE red flag; never twice", async () => {
    await chase.sweepUpgradesDayChase(new Date("2026-11-22T12:00:00Z"));
    expect((await flags(J_UP)).upgradesDayRed).toBeUndefined();
    await chase.sweepUpgradesDayChase(new Date("2026-11-22T14:00:00Z"));
    await chase.sweepUpgradesDayChase(new Date("2026-11-23T14:00:00Z"));
    expect(await rounds(J_UP)).toEqual([CHASE_ROUND.upgradesText, CHASE_ROUND.upgradesEmail, CHASE_ROUND.upgradesRed]);
    expect((await flags(J_UP)).upgradesDayRed).toBeTruthy();
    expect(textsFor(J_UP).length).toBe(1);
    expect(emailsFor(J_UP).length).toBe(1);
  });
  test("entering the day clears both office rows; nothing more is sent", async () => {
    await db.query("insert into bookings (job_id, kind, status, scheduled_start, business_id) values ($1,'rectification','confirmed','2026-11-26T00:00:00Z',$2)", [J_UP, ELEC]);
    expect(await flags(J_UP)).toEqual({});
    await chase.sweepUpgradesDayChase(new Date("2026-11-24T14:00:00Z"));
    expect(textsFor(J_UP).length).toBe(1);
    expect((await rounds(J_UP)).length).toBe(3);
  });
  test("a day entered before day 1 → nothing ever", async () => {
    expect(textsFor(J_UP_BOOKED)).toEqual([]);
    expect(emailsFor(J_UP_BOOKED)).toEqual([]);
    expect(await rounds(J_UP_BOOKED)).toEqual([]);
    expect(await flags(J_UP_BOOKED)).toEqual({});
  });
  test("a held text is tried again on later ticks and goes once the hold lifts — still only once", async () => {
    // Every earlier tick ran over J_UP_HELD too: the text round is claimed once, nothing sent, one hold logged.
    expect(textsFor(J_UP_HELD)).toEqual([]);
    expect((await rounds(J_UP_HELD))[0]).toBe(CHASE_ROUND.upgradesText);
    expect((await rounds(J_UP_HELD)).filter((r) => r === CHASE_ROUND.upgradesText).length).toBe(1);
    expect(await sentRounds(J_UP_HELD)).not.toContain(CHASE_ROUND.upgradesText);
    const heldEvents = (await db.query("select id from workflow_events where job_id=$1 and summary like 'Electrician''s upgrades day text not sent yet%'", [J_UP_HELD])).rows;
    expect(heldEvents.length).toBe(1);
    held.delete(J_UP_HELD);
    await chase.sweepUpgradesDayChase(new Date("2026-11-24T15:00:00Z"));
    await chase.sweepUpgradesDayChase(new Date("2026-11-24T16:00:00Z"));
    expect(textsFor(J_UP_HELD).length).toBe(1);
    expect((await sentRounds(J_UP_HELD)).filter((r) => r === CHASE_ROUND.upgradesText).length).toBe(1);
    expect(emailsFor(J_UP_HELD).length).toBe(1);
  });
  test("every trade send passes the recipient business + job to the pause check", () => {
    expect(pauseCalls.length).toBe(0); // text pause lives in the (stubbed) sms sender; the email stub stands in for emailInstallerOffice
    const src = readFileSync("src/lib/own-job-piesa-notices.server.ts", "utf8");
    expect(src).toContain("tradeMessagesPausedNow({ businessId: biz.id, jobId: p.jobId })");
    expect(src).toMatch(/type: spec\.type, idempotencyKey: base, to, body: "", jobId, businessId: a\.business_id/);
  });
});

describe("certificate not in", () => {
  test("Thu 5 Nov 8pm: inside 2 business days of Part C (Cup day skipped) → nothing", async () => {
    await chase.sweepCertificateChase(new Date("2026-11-05T09:00:00Z"));
    expect(textsFor(J_CERT)).toEqual([]);
  });
  test("Fri 6 Nov 8am → ONE certificate text with the link", async () => {
    await chase.sweepCertificateChase(new Date("2026-11-05T21:00:00Z"));
    await chase.sweepCertificateChase(new Date("2026-11-05T22:00:00Z"));
    const t = textsFor(J_CERT);
    expect(t.length).toBe(1);
    expect(t[0]!.type).toBe("electrician_certificate_link");
    expect(t[0]!.key).toMatch(/:chase-2bd$/);
    expect(t[0]!.body).toMatch(/^Hi Sparky, we still need the Certificate of Electrical Safety for 1 Example St, Clayton 3168\. Add it here: \S+\/e\/\S+$/);
    expect(await flags(J_CERT)).toEqual({});
  });
  test("Tue 10 Nov 8am (4 business days, weekend skipped) → ONE office flag with the electrician's phone", async () => {
    await chase.sweepCertificateChase(new Date("2026-11-09T06:00:00Z"));
    expect(await flags(J_CERT)).toEqual({});
    await chase.sweepCertificateChase(new Date("2026-11-09T21:00:00Z"));
    await chase.sweepCertificateChase(new Date("2026-11-10T21:00:00Z"));
    expect(await rounds(J_CERT)).toEqual([CHASE_ROUND.certificateText, CHASE_ROUND.certificateFlag]);
    expect((await flags(J_CERT)).certificateNotIn).toMatchObject({ electrician: "Sparky Sam", phone: "0411111111" });
    expect(textsFor(J_CERT).length).toBe(1);
  });
  test("a file on the job clears the flag", async () => {
    await db.query("insert into evidence_files (requirement_id, job_id, storage_path, mime_type) values ($1,$2,'jobs/y/electrician-uploads/abcdefgh.pdf','application/pdf')", [await reqOf(J_CERT), J_CERT]);
    expect(await flags(J_CERT)).toEqual({});
  });
  test("a file before day 2 → nothing ever", async () => {
    await chase.sweepCertificateChase(new Date("2026-11-20T21:00:00Z"));
    expect(textsFor(J_CERT_FILE)).toEqual([]);
    expect(await rounds(J_CERT_FILE)).toEqual([]);
  });
});

// Fix 1 (review): held sends must not starve the sweep. 30 due jobs with the wording held all get their rounds (and the office
// rows) in ONE tick, cheaply; once Jo approves, each sends exactly once, the 25-per-tick cap counting only real sends.
const MANY = Array.from({ length: 30 }, (_, i) => id(400 + i));
const J_NOINST = id(450), J_REASS = id(451);
const waiting = async (j: string) => (await db.query<{ summary: string; details: { round: string; reason: string } }>("select summary, details from workflow_events where job_id=$1 and event_type='certificate_chase_waiting' order by created_at", [j])).rows;
const eventCount = async () => Number((await db.query<{ n: number }>("select count(*)::int as n from workflow_events")).rows[0]!.n);
describe("held sends at scale (fix 1)", () => {
  test("setup: earlier jobs closed, 32 new due jobs; wording held", async () => {
    await db.query("update jobs set deleted_at = now()");
    const all = [...MANY, J_NOINST, J_REASS];
    for (const [i, j] of all.entries()) {
      // Oldest first: the PIESA records are a minute apart, in this order.
      const at = new Date(Date.parse(PIESA_AT) + i * 60_000).toISOString();
      await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source, job_number) values ($1,'rectification_scheduling',$2,'installer_sourced','real',$3)", [j, j === J_NOINST ? null : INST, `HV-${j.slice(-3)}`]);
      await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [j, ELEC, U1]);
      if (j !== J_NOINST) await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'installer',$2,$3)", [j, INST, U_INST]);
      await db.query("insert into assessments (job_id, mitti_raw_snapshot, completed_at) values ($1,$2,$3)", [j, JSON.stringify(snapshot("No")), at]);
      await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, created_at) values ($1,'initial','fail','2026-10-30',$2)", [j, at]);
      await db.query("insert into rectification_items (job_id, description, status) values ($1,'Replace split conduit','required')", [j]);
    }
    setWording(false);
  });
  test("Thu 5 Nov: ONE tick claims every job's text + email rounds and writes each hold once — a few requests per job", async () => {
    requests = 0;
    await chase.sweepUpgradesDayChase(new Date("2026-11-04T22:00:00Z"));
    const perJob = requests / 32;
    console.log(`held path: ${requests} requests for 32 jobs = ${perJob.toFixed(2)} per job`);
    expect(perJob).toBeLessThanOrEqual(4);
    for (const j of [...MANY, J_REASS]) {
      expect(await rounds(j)).toEqual([CHASE_ROUND.upgradesText, CHASE_ROUND.upgradesEmail]);
      expect((await waiting(j)).map((w) => w.details.reason)).toEqual(["wording_not_approved", "wording_not_approved"]);
    }
    expect((await waiting(MANY[0]!))[0]!.summary).toBe("Electrician's upgrades day text not sent yet: wording not approved");
    // The week office row is up for every job although nothing was sent.
    expect(await flags(MANY[29]!)).toMatchObject({ upgradesDayNotSet: { electrician: "Sparky Sam", address: "1 Example St, Clayton 3168" } });
    // No installer: its own reason, recorded once.
    expect((await waiting(J_NOINST)).map((w) => `${w.details.round}:${w.details.reason}`)).toEqual([`${CHASE_ROUND.upgradesText}:wording_not_approved`, `${CHASE_ROUND.upgradesEmail}:no_installer`]);
    expect(texts.filter((t) => MANY.includes(t.jobId)).length + emails.filter((e) => MANY.includes(e.jobId)).length).toBe(0);
  });
  test("the next ticks: nothing new is written and only the batched reads are paid", async () => {
    const before = await eventCount();
    requests = 0;
    await chase.sweepUpgradesDayChase(new Date("2026-11-04T23:00:00Z"));
    await chase.sweepUpgradesDayChase(new Date("2026-11-04T23:15:00Z"));
    console.log(`two held ticks: ${requests} requests for 32 jobs`);
    expect(requests).toBeLessThanOrEqual(30); // two ticks, no per-job reads
    expect(await eventCount()).toBe(before);
  });
  test("Jo approves the wording → each job sends exactly once, oldest first, at most 25 jobs a tick", async () => {
    setWording(true);
    await chase.sweepUpgradesDayChase(new Date("2026-11-04T23:30:00Z"));
    const textedAfter1 = new Set(texts.filter((t) => MANY.includes(t.jobId) || t.jobId === J_NOINST || t.jobId === J_REASS).map((t) => t.jobId));
    expect(textedAfter1.size).toBe(25);
    expect([...textedAfter1].sort()).toEqual(MANY.slice(0, 25));
    await chase.sweepUpgradesDayChase(new Date("2026-11-04T23:45:00Z"));
    await chase.sweepUpgradesDayChase(new Date("2026-11-05T00:00:00Z"));
    for (const j of [...MANY, J_REASS]) {
      expect(textsFor(j).length).toBe(1);
      expect(emailsFor(j).length).toBe(1);
      expect(await sentRounds(j)).toEqual(expect.arrayContaining([CHASE_ROUND.upgradesText, CHASE_ROUND.upgradesEmail]));
    }
    expect(textsFor(J_NOINST).length).toBe(1);
  });
  test("no installer: one waiting marker, no retry each tick; the email goes once an installer is assigned", async () => {
    expect(emailsFor(J_NOINST)).toEqual([]);
    expect((await waiting(J_NOINST)).filter((w) => w.details.reason === "no_installer").length).toBe(1);
    await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'installer',$2,$3)", [J_NOINST, INST, U_INST]);
    await chase.sweepUpgradesDayChase(new Date("2026-11-05T00:15:00Z"));
    await chase.sweepUpgradesDayChase(new Date("2026-11-05T00:30:00Z"));
    expect(emailsFor(J_NOINST).length).toBe(1);
    expect((await waiting(J_NOINST)).filter((w) => w.details.reason === "no_installer").length).toBe(1);
  });
  test("a reassessment clears the old 7-days-left flag (rows follow the current PIESA record)", async () => {
    await chase.sweepUpgradesDayChase(new Date("2026-11-22T14:00:00Z"));
    expect((await flags(J_REASS)).upgradesDayRed).toBeTruthy();
    await db.query("update piesa_records set is_current = false where job_id = $1", [J_REASS]);
    await db.query("insert into piesa_records (job_id, kind, outcome, completed_date, created_at) values ($1,'reassessment','fail','2026-11-23','2026-11-23T00:00:00Z')", [J_REASS]);
    expect(await flags(J_REASS)).toEqual({});
  });
});

describe("wiring", () => {
  test("both sweeps run on the allocation tick; Needs me reads the chase flags; the no-file certificate row is hidden", () => {
    const tick = readFileSync("src/routes/api/public/hooks/allocation-tick.ts", "utf8");
    expect(tick).toContain('timed("sweepUpgradesDayChase", () => sweepUpgradesDayChase())');
    expect(tick).toContain('timed("sweepCertificateChase", () => sweepCertificateChase())');
    const needs = readFileSync("src/lib/office-needs.server.ts", "utf8");
    expect(needs).toContain("chaseFlagsForJobs(");
    const coes = readFileSync("src/lib/coes-check.server.ts", "utf8");
    expect(coes).toContain("if (!c.ref.files.length) return null;");
  });
});
