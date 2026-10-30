// Jo 24 Oct 2026 (decisions 49–53) against real Postgres rows (PGlite, fake TEST data only):
// office pick → exactly one offer to one installer (+ the held text); "Not for me" / 24 hours → back to the office with
// ONE item; installer offers 3 times → owner taps one → the canonical booking path (confirmBooking + Mitti form) runs.
// The booking path, Mitti and senders are mocked; nothing leaves the test.
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const JOB = "10000000-0000-4000-8000-000000000001", OWN = "10000000-0000-4000-8000-000000000002", PROP = "20000000-0000-4000-8000-000000000001";
const BIZ = "30000000-0000-4000-8000-000000000001", BIZ2 = "30000000-0000-4000-8000-000000000002";
const INST = "40000000-0000-4000-8000-000000000001", OWNER = "40000000-0000-4000-8000-000000000009";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, stage text, channel text, source text, deleted_at timestamptz, job_number text, property_id uuid, next_action text, originating_installer_business_id uuid);
CREATE TABLE properties (id uuid primary key, suburb text, postcode text);
CREATE TABLE businesses (id uuid primary key, name text, onboarding_notes text);
CREATE TABLE business_members (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, active boolean default true);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, user_id uuid, business_id uuid, role text, active boolean default true);
CREATE TABLE partner_offers (id uuid primary key default gen_random_uuid(), job_id uuid, business_id uuid, kind text, status text default 'pending', batch int default 1, summary jsonb,
  offered_by uuid, offered_at timestamptz default now(), expires_at timestamptz, responded_by uuid, responded_at timestamptz, decline_reason text, superseded_at timestamptz);
CREATE TABLE appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid not null, kind text, proposed_by uuid not null,
  proposer_role text not null check (proposer_role in ('owner','electrician','installer','admin')), assignment_id uuid, starts_at timestamptz not null, ends_at timestamptz, note text,
  status text not null default 'proposed' check (status in ('proposed','accepted','declined','superseded','cancelled')), responded_by uuid, responded_at timestamptz, response_note text);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
CREATE TABLE workflow_settings (id int primary key, ready_check_booking_enabled boolean);
CREATE TABLE ready_check_windows (id uuid primary key default gen_random_uuid(), job_id uuid, status text, starts_at timestamptz);
INSERT INTO workflow_settings VALUES (1, true);
INSERT INTO properties VALUES ('${PROP}','Frankston','3199');
INSERT INTO jobs VALUES ('${JOB}','ready_check_ready_to_schedule','hivic_sourced','qa_test',null,'HV-T1','${PROP}',null,null),
  ('${OWN}','ready_check_ready_to_schedule','installer_sourced','qa_test',null,'HV-T2','${PROP}',null,'${BIZ}');
INSERT INTO businesses VALUES ('${BIZ}','TEST Alpha','[TEST PARTNER]'),('${BIZ2}','TEST Beta','[TEST PARTNER]');
INSERT INTO business_members (business_id, user_id) VALUES ('${BIZ}','${INST}');`);

const shim = postgrestShim(db);
// This fixture's SQL shim cannot project joined selects. Model the new read from its real assignment rows.
mock.module("../src/lib/in-house-suppression.server", () => ({
  inHouseDispatchSkip: async (jobId: string) => {
    const rows = (await db.query("select id from job_assignments where job_id=$1 and role='installer' and active", [jobId])).rows;
    // All businesses in this existing non-in-house/TEST flow fixture remain ordinary partners.
    return rows.length >= 0 ? null : "in_house_read_failed";
  },
}));
const calls = { texts: [] as string[], bookings: [] as string[], forms: [] as string[], emails: [] as string[][] };
// Minimal stand-in for the SQL accept_ready_check_offer (the real one is proven in its own migration tests).
const rpc = async (name: string, a: Record<string, unknown>) => {
  if (name === "has_role") return { data: true, error: null };
  if (name === "accept_ready_check_offer") {
    const o = (await db.query<{ job_id: string; business_id: string; status: string }>("select job_id, business_id, status from partner_offers where id=$1", [a["_offer"]])).rows[0];
    if (!o || o.status !== "pending") return { data: [{ outcome: `already_${o?.status ?? "missing"}` }], error: null };
    await db.query("update partner_offers set status='accepted', responded_by=$2, responded_at=now() where id=$1", [a["_offer"], a["_user"]]);
    await db.query("insert into job_assignments (job_id, user_id, business_id, role) values ($1,$2,$3,'installer')", [o.job_id, a["_user"], o.business_id]);
    return { data: [{ outcome: "accepted" }], error: null };
  }
  return { data: null, error: { message: `unexpected rpc ${name}` } };
};
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...shim, rpc } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
}));
mock.module("../src/lib/ready-check-booking-access.server", () => ({
  readyCheckBookingAccess: async () => ({ enabled: true, offeredAt: "2026-10-24T00:00:00Z", allowed: true }),
  assertOwnerReadyCheckBooking: async () => {},
}));
mock.module("../src/lib/readycheck-booking.server", () => ({
  installerCandidatesFor: async () => ({ postcode: "3199", candidates: [
    { business_id: BIZ, name: "TEST Alpha", blocker: null }, { business_id: BIZ2, name: "TEST Beta", blocker: "No approved installer with a Full, current EEC certification recorded." },
  ] }),
}));
mock.module("../src/lib/ready-check-offer-text.server", () => ({ textInstallerAboutOffer: async (id: string) => { calls.texts.push(id); return "blocked: Wording not approved yet"; }, emailInstallerAboutOffer: async () => "blocked: TEST fixture" }));
mock.module("../src/lib/ready-check-times-email.server", () => ({ emailOwnerReadyCheckTimes: async (_j: string, s: string[]) => { calls.emails.push(s); return "not sent — wording awaiting approval"; } }));
mock.module("../src/lib/booking.server", () => ({
  confirmBooking: async (jobId: string, kind: string, start: string, actor: string, label: string) => {
    calls.bookings.push(`${kind}|${start}|${actor}|${label}`);
    await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,$2,'confirmed',$3)", [jobId, kind, start]);
    await db.query("update jobs set stage='ready_check_scheduled' where id=$1", [jobId]);
    return { ok: true };
  },
}));
mock.module("../src/lib/mitti-create.server", () => ({ onReadyCheckBooked: async (jobId: string) => { calls.forms.push(jobId); return "scheduled"; } }));

const rc = await import("../src/lib/ready-check-times.server");
const core = await import("../src/lib/ready-check-times.core");
const q = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const officeItem = async () => {
  const offers = await q<{ status: string; offered_at: string }>("select status, offered_at::text from partner_offers where job_id=$1", [JOB]);
  const [j] = await q<{ channel: string; stage: string }>("select channel, stage from jobs where id=$1", [JOB]);
  const [{ n }] = await q<{ n: number }>("select count(*)::int n from job_assignments where job_id=$1 and role='installer' and active", [JOB]);
  return core.readyCheckOfficeItem({ channel: j!.channel, stage: j!.stage, hasInstaller: n > 0, offers: offers.map((o) => ({ ...o, offered_at: new Date(o.offered_at).toISOString() })) });
};

describe("office picks one installer", () => {
  test("before anything is sent the office sees one 'choose installer' item", async () => expect(await officeItem()).toEqual({ code: "choose_installer" }));
  test("several installers at once is refused; nothing written", async () => {
    await expect(rc.officePickReadyCheckInstaller(JOB, null, [BIZ, BIZ2])).rejects.toThrow(/Choose one installer/);
    expect(await q("select id from partner_offers")).toHaveLength(0);
  });
  test("an ineligible installer is refused", async () => {
    await expect(rc.officePickReadyCheckInstaller(JOB, null, [BIZ2])).rejects.toThrow(/can't take this Ready Check/);
  });
  test("installer's own customer: never offered", async () => {
    await expect(rc.officePickReadyCheckInstaller(OWN, null, [BIZ])).rejects.toThrow(/directly/);
  });
  test("one pick → exactly one offer to that installer, open 24 hours, text attempted once", async () => {
    const r = await rc.officePickReadyCheckInstaller(JOB, null, [BIZ]);
    const rows = await q<{ business_id: string; status: string; hrs: number; summary: Record<string, unknown> }>("select business_id, status, round(extract(epoch from (expires_at - offered_at))/3600) hrs, summary from partner_offers where job_id=$1", [JOB]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.business_id).toBe(BIZ);
    expect(Number(rows[0]!.hrs)).toBe(24);
    expect(rows[0]!.summary).toMatchObject({ office_choice: true, ready_check_times: true, suburb: "Frankston" });
    expect(calls.texts).toEqual([r.offerId]);
    expect(await officeItem()).toBeNull(); // nothing for the office while the offer is open
    await expect(rc.officePickReadyCheckInstaller(JOB, null, [BIZ])).rejects.toThrow(/already open/);
  });
});

describe("Not for me / 24 hours → back to the office (one item)", () => {
  test("decline closes the offer and returns the job once", async () => {
    const [{ id }] = await q<{ id: string }>("select id from partner_offers where job_id=$1 and status='pending'", [JOB]);
    await rc.declineReadyCheckOffer(id, INST, "Too far");
    expect(await officeItem()).toMatchObject({ code: "offer_returned", status: "declined" });
    expect(await q("select id from partner_offers where status='pending'")).toHaveLength(0); // nothing re-offered automatically
    await expect(rc.declineReadyCheckOffer(id, INST, null)).rejects.toThrow(/no longer open/);
    expect(await q("select id from workflow_events where event_type='ready_check_offer_returned'")).toHaveLength(1);
  });
  test("24 hours without times: the timer closes it, once, and the office picks again", async () => {
    await db.exec(`update partner_offers set offered_at = now() - interval '2 days'`); // the earlier decline is older
    // The office's next pick, now 25 hours old with no times offered.
    await db.query("insert into partner_offers (job_id, business_id, kind, status, offered_at, expires_at, summary) values ($1,$2,'ready_check','pending', now() - interval '25 hours', now() - interval '1 hour', '{}')", [JOB, BIZ2]);
    expect(await officeItem()).toBeNull();
    const a = await rc.sweepOfficePickedOffers(null);
    const b = await rc.sweepOfficePickedOffers(null);
    expect([a.expired, b.expired]).toEqual([1, 0]);
    expect(await officeItem()).toMatchObject({ code: "offer_returned", status: "expired" });
    expect(await q("select id from workflow_events where event_type='ready_check_offer_returned'")).toHaveLength(2); // one per returned offer
  });
});

describe("installer offers 3 times; owner taps one → booked through the canonical path", () => {
  let offerId = "";
  test("times are checked before anything is accepted", async () => {
    await db.exec("delete from partner_offers");
    offerId = (await rc.officePickReadyCheckInstaller(JOB, null, [BIZ])).offerId;
    await expect(rc.acceptOfferWithTimes(offerId, INST, [{ day: core.allowedReadyCheckDays()[3]!, time: "09:00" }])).rejects.toThrow(/choose 3 times/);
    expect(await q("select id from job_assignments where job_id=$1", [JOB])).toHaveLength(0);
  });
  test("accept = 3 installer times for the owner (no booking yet); owner email hook held", async () => {
    const days = core.allowedReadyCheckDays().slice(2, 5);
    await rc.acceptOfferWithTimes(offerId, INST, days.map((day) => ({ day, time: "09:30" })));
    const props = await q<{ proposer_role: string; status: string; note: string }>("select proposer_role, status, note from appointment_proposals where job_id=$1", [JOB]);
    expect(props).toHaveLength(3);
    expect(props.every((p) => p.proposer_role === "installer" && p.status === "proposed" && p.note === core.READY_CHECK_TIME_NOTE)).toBe(true);
    expect(calls.emails).toHaveLength(1);
    expect(calls.bookings).toHaveLength(0);
    const s = await rc.ownerReadyCheckTimesState(JOB);
    expect(s).toMatchObject({ applies: true, allowed: true, turn: "owner_to_answer" });
  });
  test("owner suggests days → installer's move → installer offers 3 new times → owner's move again", async () => {
    const d = core.allowedReadyCheckDays();
    await rc.ownerSuggestReadyCheckDays(JOB, OWNER, [d[6]!, d[7]!]);
    expect((await rc.installerReadyCheckState(JOB, INST)).turn).toBe("installer_to_answer");
    await rc.installerOfferNewTimes(JOB, INST, [d[8]!, d[9]!, d[10]!].map((day) => ({ day, time: "14:00" })));
    expect((await rc.ownerReadyCheckTimesState(JOB) as { turn: string }).turn).toBe("owner_to_answer");
    expect(calls.bookings).toHaveLength(0);
  });
  test("owner taps one → confirmBooking(job, ready_check, that time) + Mitti form; the rest close", async () => {
    const [p] = await q<{ id: string; starts_at: string }>("select id, starts_at from appointment_proposals where job_id=$1 and status='proposed' order by starts_at limit 1", [JOB]);
    const r = await rc.ownerTakeReadyCheckTime(JOB, p!.id, OWNER);
    expect(r).toEqual({ ok: true, booked: true });
    expect(calls.bookings).toEqual([`ready_check|${new Date(p!.starts_at).toISOString()}|${OWNER}|owner (installer's offered time)`]);
    expect(calls.forms).toEqual([JOB]);
    expect(await q("select id from appointment_proposals where job_id=$1 and status='proposed'", [JOB])).toHaveLength(0);
    await expect(rc.ownerTakeReadyCheckTime(JOB, p!.id, OWNER)).rejects.toThrow();
  });
});

test("one-job timing filter never expires another TEST offer or closes its windows", async () => {
  await db.query("insert into partner_offers (job_id,business_id,kind,status,offered_at,expires_at) values ($1,$3,'ready_check','pending',now()-interval '25 hours',now()-interval '1 hour'),($2,$3,'ready_check','pending',now()-interval '25 hours',now()-interval '1 hour')", [JOB, OWN, BIZ]);
  await db.query("insert into ready_check_windows(job_id,status,starts_at) values ($1,'open',now()-interval '1 hour'),($2,'open',now()-interval '1 hour')", [JOB, OWN]);
  expect((await rc.sweepOfficePickedOffers(null, new Date(), JOB)).expired).toBe(1);
  expect((await rc.sweepOfficePickedOffers(null, new Date(), JOB)).expired).toBe(0);
  expect(await q("select status from partner_offers where job_id=$1 and status='pending'", [OWN])).toHaveLength(1);
  expect(await q("select status from ready_check_windows where job_id=$1 and status='open'", [OWN])).toHaveLength(1);
});
