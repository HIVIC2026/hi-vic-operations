// Part 2 Task 4: the installer office can book an own job's safety check (when the installer's "who books" setting allows
// it), and a job still unbooked 2 business days after the hand-over is returned to the office once (one event, one email).
// Real rows in PGlite; the in-house lookup, the booking writer and the owner notice are stubbed at their seams.
import { describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";
import { addMelbourneBusinessDays } from "../src/lib/melbourne-time.core";
import { deadlineAction } from "../src/lib/own-job-piesa.core";

describe("deadlineAction", () => {
  const due = (handedIso: string) => addMelbourneBusinessDays(handedIso, 2);
  const act = (dueAt: string, now: string, o: { booked?: boolean; alreadyReturned?: boolean } = {}) => deadlineAction({ dueAt, booked: false, alreadyReturned: false, ...o, now: new Date(now) });
  test("a Thursday hand-over is due at the end of Monday (weekend skipped)", () => {
    const d = due("2026-10-29T01:00:00Z"); // Thu 29 Oct 12:00 Melbourne
    expect(act(d, "2026-11-02T12:00:00Z")).toBe("none"); // Mon 2 Nov 23:00 Melbourne: still inside
    expect(act(d, "2026-11-02T13:30:00Z")).toBe("return"); // Tue 3 Nov 00:30 Melbourne
  });
  test("a Friday hand-over skips the weekend AND Melbourne Cup (Tue 3 Nov 2026): due end of Wed 4 Nov", () => {
    const d = due("2026-10-30T01:00:00Z");
    expect(act(d, "2026-11-03T12:00:00Z")).toBe("none"); // Cup Day itself
    expect(act(d, "2026-11-04T12:00:00Z")).toBe("none"); // Wed 4 Nov 23:00 Melbourne
    expect(act(d, "2026-11-04T13:30:00Z")).toBe("return"); // Thu 5 Nov 00:30 Melbourne
  });
  test("booked or already returned is never returned; junk due date does nothing", () => {
    const d = due("2026-10-29T01:00:00Z");
    expect(act(d, "2026-12-01T00:00:00Z", { booked: true })).toBe("none");
    expect(act(d, "2026-12-01T00:00:00Z", { alreadyReturned: true })).toBe("none");
    expect(act("nonsense", "2026-12-01T00:00:00Z")).toBe("none");
  });
});

const db = new PGlite();
await db.exec(`
CREATE TABLE businesses (id uuid primary key, name text, trading_name text, email text, phone text, onboarding_notes text, piesa_booked_by text);
CREATE TABLE jobs (id uuid primary key, stage text, deleted_at timestamptz, originating_installer_business_id uuid, channel text, source text, created_at timestamptz default clock_timestamp());
CREATE VIEW job_overview AS SELECT id, 'HV-1'::text AS job_number, '1 Example St, Clayton 3168'::text AS property_address FROM jobs;
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean, created_at timestamptz default clock_timestamp());
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null, role text not null, business_id uuid, user_id uuid not null, active boolean not null default true, booking_confirmed_at timestamptz, assigned_at timestamptz default clock_timestamp());
CREATE TABLE business_members (user_id uuid, business_id uuid, active boolean default true);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, scheduled_start timestamptz, status text, created_at timestamptz default clock_timestamp());
CREATE TABLE appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text);
`);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const INST_OFFICE = id(1), INST_ELEC = id(2), INST_EITHER = id(3), ELEC = id(4);
const U_OFFICE = id(11), U_ELEC_BOSS = id(12), U_EITHER = id(13), U_STRANGER = id(14), U_SPARKY = id(15);
const J_LATE = id(101), J_BOOKED = id(102), J_FRESH = id(103), J_ELEC = id(104), J_EITHER = id(105), J_LEAD = id(106), J_WRONG_STAGE = id(107), J_LATE2 = id(108);
await db.query(`insert into businesses values ($1,'Office Co','Office Co','office@office.test',null,null,'office'), ($2,'Elec Co','Elec Co','office@elec.test',null,null,'electrician'), ($3,'Either Co','Either Co','office@either.test',null,null,'either'), ($4,'Sparky','Sparky',null,'0411111111',null,null)`, [INST_OFFICE, INST_ELEC, INST_EITHER, ELEC]);
await db.query("insert into business_members values ($1,$2,true), ($3,$4,true), ($5,$6,true)", [U_OFFICE, INST_OFFICE, U_ELEC_BOSS, INST_ELEC, U_EITHER, INST_EITHER]);
const seed = async (job: string, inst: string, o: { stage?: string; channel?: string; booked?: boolean; due?: string | null } = {}) => {
  await db.query("insert into jobs (id, stage, originating_installer_business_id, channel, source) values ($1,$2,$3,$4,'real')", [job, o.stage ?? "piesa_and_install_window_pending", inst, o.channel ?? "installer_sourced"]);
  await db.query("insert into job_assignments (job_id, role, business_id, user_id, booking_confirmed_at) values ($1,'electrician',$2,$3,$4)", [job, ELEC, U_SPARKY, o.booked ? new Date().toISOString() : null]);
  if (o.due !== null) await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'own_job_piesa_handed','handed',$2,true)", [job, JSON.stringify({ key: `own_job_piesa:${job}:first`, due_at: o.due ?? "2026-11-02T12:59:59.999Z" })]);
};
await seed(J_LATE, INST_OFFICE);
await seed(J_BOOKED, INST_OFFICE, { booked: true });
await seed(J_FRESH, INST_OFFICE, { due: "2099-01-01T00:00:00.000Z" });
await seed(J_ELEC, INST_ELEC, { due: "2099-01-01T00:00:00.000Z" });
await seed(J_EITHER, INST_EITHER, { due: "2099-01-01T00:00:00.000Z" });
await seed(J_LEAD, INST_OFFICE, { channel: "hivic_sourced" });
await seed(J_WRONG_STAGE, INST_OFFICE, { stage: "piesa_scheduled" });
await seed(J_LATE2, INST_OFFICE);

const heldInHouse = new Set<string>([J_LATE2]); // an in-house partner job, overdue: never returned here
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: postgrestShim(db) }));
let commsOn = true;
mock.module("../src/lib/comms.server", () => ({ customerCommsEnabled: async () => commsOn, hasCurrentOwnerContactConsent: async () => true }));
const realSuppression = await import("../src/lib/in-house-suppression.server");
mock.module("../src/lib/in-house-suppression.server", () => ({
  ...realSuppression,
  readInHouseDispatchState: async () => ({ held: new Set(heldInHouse), failed: false }),
  inHouseDispatchSkip: async (jobId: string, state?: { held: Set<string>; failed: boolean }) => (state?.failed ? "in_house_read_failed" : (state?.held ?? heldInHouse).has(jobId) ? "in_house" : null),
}));
const realCore = await import("../src/lib/own-job-electrician-link.core");
mock.module("../src/lib/own-job-electrician-link.core", () => ({ ...realCore, OWN_JOB_PIESA_NOT_BOOKED_EMAIL_APPROVED: true }));
const realPayments = await import("../src/lib/payments.server");
mock.module("../src/lib/payments.server", () => ({ ...realPayments, jobPaymentView: async () => null }));
mock.module("../src/lib/trade-pause.server", () => ({ tradeMessagesPausedNow: async () => null }));
const sent: { subject: string; businessId: string; pauseJobId: string }[] = [];
mock.module("../src/lib/office-email.server", () => ({ sendOfficeEmail: async (p: { subject: string; record: { businessId: string }; pauseJobId: string }) => { sent.push({ subject: p.subject, businessId: p.record.businessId, pauseJobId: p.pauseJobId }); return { status: "sent" }; } }));
const confirmed: unknown[][] = [];
mock.module("../src/lib/booking.server", () => ({
  confirmBooking: async (...a: unknown[]) => { confirmed.push(a); await db.query("update job_assignments set booking_confirmed_at = now() where job_id = $1 and role = 'electrician'", [a[0]]); await db.query("update jobs set stage = 'piesa_scheduled' where id = $1", [a[0]]); },
}));
const saved: unknown[] = [];
mock.module("../src/lib/in-house-atomic-save.server", () => ({ saveInHouseVisit: async (...a: unknown[]) => { saved.push(a); return { bookingId: "x" }; } }));
const owner: string[] = [];
mock.module("../src/lib/in-house-booking.server", () => ({ notifyOwnerBooked: async (job: string) => { owner.push(job); return "sent"; } }));

const { inHouseBookVisit } = await import("../src/lib/trade-view.server");
const { bookOwnJobPiesa } = await import("../src/lib/own-job-electrician-link.server");
const { sweepOwnJobPiesaDeadlines, ownJobOfficeBookingAccess, officeBookOwnJobPiesa } = await import("../src/lib/own-job-piesa.server");
const NOW = new Date("2026-11-04T00:00:00Z"); // after the seeded due date (end of Mon 2 Nov)
const J_SWAP = id(109), J_RACE = id(110);
await seed(J_SWAP, INST_OFFICE);
await seed(J_RACE, INST_OFFICE, { due: "2099-01-01T00:00:00.000Z" });
const countEvents = async (job: string, type: string) => Number((await db.query<{ n: string }>("select count(*) n from workflow_events where job_id=$1 and event_type=$2", [job, type])).rows[0]!.n);

describe("deadline sweep", () => {
  test("no booking after the due date: one return and one email; a second sweep does nothing", async () => {
    const first = await sweepOwnJobPiesaDeadlines(NOW);
    expect(first.returned).toBe(2); // J_LATE and J_SWAP
    expect(await countEvents(J_LATE, "own_job_piesa_not_booked")).toBe(1);
    expect(sent.filter((s) => s.pauseJobId === J_LATE).map((s) => [s.subject, s.businessId])).toEqual([["Not booked yet — book it or pick another electrician", INST_OFFICE]]);
    const second = await sweepOwnJobPiesaDeadlines(new Date(NOW.getTime() + 3_600_000));
    expect(second.returned).toBe(0);
    expect(await countEvents(J_LATE, "own_job_piesa_not_booked")).toBe(1);
    expect(sent).toHaveLength(2);
  });
  test("booked, not yet due, wrong stage, HIV-lead and in-house jobs are left alone", async () => {
    for (const j of [J_BOOKED, J_FRESH, J_WRONG_STAGE, J_LEAD, J_ELEC, J_EITHER]) expect(await countEvents(j, "own_job_piesa_not_booked")).toBe(0);
    expect(await countEvents(J_LATE2, "own_job_piesa_not_booked")).toBe(0);
  });
});

describe("office booking access", () => {
  test("the office of a booker=office installer can book its own job's safety check", async () => {
    const a = await ownJobOfficeBookingAccess(U_OFFICE, J_LATE);
    expect(a.allowed).toBe(true);
  });
  test("booker=either also allows the office", async () => {
    expect((await ownJobOfficeBookingAccess(U_EITHER, J_EITHER)).allowed).toBe(true);
  });
  test("the office of a booker=electrician installer does not", async () => {
    expect((await ownJobOfficeBookingAccess(U_ELEC_BOSS, J_ELEC)).allowed).toBe(false);
  });
  test("a stranger, an HIV-lead job, a booked stage and an in-house job do not", async () => {
    expect((await ownJobOfficeBookingAccess(U_STRANGER, J_LATE)).allowed).toBe(false);
    expect((await ownJobOfficeBookingAccess(U_OFFICE, J_LEAD)).allowed).toBe(false);
    expect((await ownJobOfficeBookingAccess(U_OFFICE, J_WRONG_STAGE)).allowed).toBe(false);
    heldInHouse.add(J_LATE);
    expect((await ownJobOfficeBookingAccess(U_OFFICE, J_LATE)).allowed).toBe(false);
    heldInHouse.delete(J_LATE);
  });
  test("inHouseBookingAccess lets the own-job office in and flags it as an own job", async () => {
    const { inHouseBookingAccess } = await import("../src/lib/trade-view.server");
    const ok = await inHouseBookingAccess(U_OFFICE, J_FRESH, postgrestShim(db) as never);
    expect(ok).toMatchObject({ allowed: true, ownJob: true });
    expect(await inHouseBookingAccess(U_ELEC_BOSS, J_ELEC, postgrestShim(db) as never)).toMatchObject({ allowed: false });
  });
});

describe("office books the safety check", () => {
  const start = "2026-11-10T00:00:00.000Z";
  test("books against the existing electrician assignment, once, with the owner notice", async () => {
    const r = await officeBookOwnJobPiesa(U_OFFICE, J_FRESH, start, NOW);
    expect(r).toEqual({ ok: true, start });
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]!.slice(0, 4)).toEqual([J_FRESH, "assessment", start, U_OFFICE]);
    expect(owner).toEqual([J_FRESH]);
    await expect(officeBookOwnJobPiesa(U_OFFICE, J_FRESH, start, NOW)).rejects.toThrow();
    expect(confirmed).toHaveLength(1);
  });
  test("an office not allowed to book is refused", async () => {
    await expect(officeBookOwnJobPiesa(U_ELEC_BOSS, J_ELEC, start, NOW)).rejects.toThrow();
    expect(confirmed).toHaveLength(1);
  });
});

describe("one email per hand-over", () => {
  test("a swap (new handed event, later due date) restarts the clock: no email until it passes, then exactly one more", async () => {
    const before = 0;
    await sweepOwnJobPiesaDeadlines(NOW);
    expect(sent.filter((m) => m.pauseJobId === J_SWAP).length - before).toBe(1); // the first deadline's email
    // swap: a fresh assignment and a fresh hand-over event due later
    await db.query("update job_assignments set active=false where job_id=$1", [J_SWAP]);
    await db.query("insert into job_assignments (job_id, role, business_id, user_id) values ($1,'electrician',$2,$3)", [J_SWAP, ELEC, U_SPARKY]);
    await db.query("insert into workflow_events (job_id, event_type, summary, details, internal) values ($1,'own_job_piesa_handed','handed again',$2,true)", [J_SWAP, JSON.stringify({ key: `own_job_piesa:${J_SWAP}:first`, due_at: "2026-11-10T12:59:59.999Z" })]);
    await sweepOwnJobPiesaDeadlines(NOW);
    expect(sent.filter((m) => m.pauseJobId === J_SWAP).length - before).toBe(1);
    await sweepOwnJobPiesaDeadlines(new Date("2026-11-11T00:00:00Z"));
    await sweepOwnJobPiesaDeadlines(new Date("2026-11-11T01:00:00Z"));
    expect(sent.filter((m) => m.pauseJobId === J_SWAP).length - before).toBe(2);
    expect(await countEvents(J_SWAP, "own_job_piesa_not_booked")).toBe(2);
  });
});

describe("one booking path for own jobs", () => {
  test("inHouseBookVisit on an own job is refused and writes nothing", async () => {
    const bookingsBefore = Number((await db.query<{ n: string }>("select count(*) n from bookings")).rows[0]!.n);
    const eventsBefore = Number((await db.query<{ n: string }>("select count(*) n from workflow_events")).rows[0]!.n);
    const calls = confirmed.length;
    const r = await inHouseBookVisit(U_OFFICE, { jobId: J_RACE, kind: "assessment", start: "2026-11-10T00:00:00.000Z", workerId: id(999) }, postgrestShim(db) as never);
    expect(r.ok).toBe(false);
    expect(saved).toHaveLength(0);
    expect(confirmed).toHaveLength(calls);
    expect(Number((await db.query<{ n: string }>("select count(*) n from bookings")).rows[0]!.n)).toBe(bookingsBefore);
    expect(Number((await db.query<{ n: string }>("select count(*) n from workflow_events")).rows[0]!.n)).toBe(eventsBefore);
  });
  test("office and electrician link booking at once: one booking, the other gets 'already booked'", async () => {
    const { rows } = await db.query<{ id: string; user_id: string; business_id: string; booking_confirmed_at: string | null }>("select id, user_id, business_id, booking_confirmed_at from job_assignments where job_id=$1 and active", [J_RACE]);
    const a = rows[0]!;
    const calls = confirmed.length;
    const start = "2026-11-10T00:00:00.000Z";
    const mk = (actorId: string, by: string) => bookOwnJobPiesa({ jobId: J_RACE, assignment: a, electricianBusinessId: ELEC, startIso: start, actorId, by, now: NOW });
    const results = await Promise.allSettled([mk(U_OFFICE, "installer office"), mk(U_SPARKY, "electrician's link")]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(String(lost.reason.message)).toContain("already booked");
    expect(confirmed.length - calls).toBe(1);
  });
});
