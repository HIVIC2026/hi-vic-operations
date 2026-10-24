// Jo 24 Oct 2026 (decision 80) against real Postgres rows (PGlite, fake TEST data only): a booked our-lead Ready Check
// can be changed by either side. Owner → booking cancelled, back to the installer to offer 3 new times (the booking is
// restored if the stage can't move back). Installer → new day + time rebooked through confirmBooking. Either way the
// owner "You're booked" hook runs. Installers' own customers can't. Booking path, transition and senders are mocked.
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { postgrestShim } from "./helpers/pglite-postgrest-shim";

const JOB = "10000000-0000-4000-8000-000000000001", OWN = "10000000-0000-4000-8000-000000000002";
const BIZ = "30000000-0000-4000-8000-000000000001", INST = "40000000-0000-4000-8000-000000000001", OTHER = "40000000-0000-4000-8000-000000000005";
const OWNER = "40000000-0000-4000-8000-000000000009";

const db = new PGlite();
await db.exec(`
CREATE TABLE jobs (id uuid primary key, stage text, channel text, source text, deleted_at timestamptz, job_number text, next_action text);
CREATE TABLE business_members (id uuid primary key default gen_random_uuid(), business_id uuid, user_id uuid, active boolean default true);
CREATE TABLE job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid, user_id uuid, business_id uuid, role text, active boolean default true);
CREATE TABLE appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid not null, kind text, proposed_by uuid not null,
  proposer_role text not null check (proposer_role in ('owner','electrician','installer','admin')), assignment_id uuid, starts_at timestamptz not null, ends_at timestamptz, note text,
  status text not null default 'proposed' check (status in ('proposed','accepted','declined','superseded','cancelled')), responded_by uuid, responded_at timestamptz, response_note text);
CREATE TABLE bookings (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text, scheduled_start timestamptz);
CREATE TABLE workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, created_at timestamptz default clock_timestamp());
INSERT INTO jobs VALUES ('${JOB}','ready_check_scheduled','hivic_sourced','qa_test',null,'HV-T1',null),('${OWN}','ready_check_scheduled','installer_sourced','qa_test',null,'HV-T2',null);
INSERT INTO job_assignments (job_id, user_id, business_id, role) VALUES ('${JOB}','${INST}','${BIZ}','installer'),('${OWN}','${INST}','${BIZ}','installer');
INSERT INTO business_members (business_id, user_id) VALUES ('${BIZ}','${INST}');`);

const shim = postgrestShim(db);
const calls = { bookings: [] as string[], booked: [] as string[], transitions: [] as string[] };
let failTransition = false;
mock.module("@/integrations/supabase/client.server", () => ({ supabaseAdmin: { ...shim, rpc: async () => ({ data: null, error: { message: "unexpected rpc" } }) } }));
const realWorkflow = await import("../src/lib/workflow.server");
mock.module("../src/lib/workflow.server", () => ({
  ...realWorkflow,
  logEvent: async (job: string, actor: string | null, type: string, summary: string, details?: unknown) => { await db.query("insert into workflow_events (job_id, actor_id, event_type, summary, details) values ($1,$2,$3,$4,$5)", [job, actor, type, summary, JSON.stringify(details ?? {})]); },
  transition: async (jobId: string, to: string) => {
    if (failTransition) throw new realWorkflow.WorkflowError("Blocked: test");
    calls.transitions.push(`${jobId}|${to}`);
    await db.query("update jobs set stage=$2 where id=$1", [jobId, to]);
  },
}));
mock.module("../src/lib/ready-check-booking-access.server", () => ({
  readyCheckBookingAccess: async () => ({ enabled: true, offeredAt: "2026-10-24T00:00:00Z", allowed: true }),
  assertOwnerReadyCheckBooking: async () => {},
}));
mock.module("../src/lib/ready-check-times-email.server", () => ({ emailOwnerReadyCheckTimes: async () => "not sent — wording awaiting approval" }));
mock.module("../src/lib/ready-check-booked-email.server", () => ({ emailOwnerReadyCheckBooked: async (_j: string, s: string) => { calls.booked.push(s); return "not sent — wording awaiting approval"; } }));
mock.module("../src/lib/booking.server", () => ({
  // Mirrors confirmBooking for ready_check: cancels the old confirmed booking, writes the new one, booked stage.
  confirmBooking: async (jobId: string, kind: string, start: string, actor: string, label: string) => {
    calls.bookings.push(`${kind}|${start}|${actor}|${label}`);
    await db.query("update bookings set status='cancelled' where job_id=$1 and kind=$2 and status='confirmed'", [jobId, kind]);
    await db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,$2,'confirmed',$3)", [jobId, kind, start]);
    await db.query("update jobs set stage='ready_check_scheduled' where id=$1", [jobId]);
    return { ok: true };
  },
}));
mock.module("../src/lib/mitti-create.server", () => ({ onReadyCheckBooked: async () => "skipped" }));

const rc = await import("../src/lib/ready-check-times.server");
const core = await import("../src/lib/ready-check-times.core");
const q = async <T,>(sql: string, p: unknown[] = []) => (await db.query<T>(sql, p)).rows;
const book = async (job: string, day: string) => db.query("insert into bookings (job_id, kind, status, scheduled_start) values ($1,'ready_check','confirmed',$2)", [job, core.readyCheckStartAt(day, "09:00").toISOString()]);
const stage = async (job = JOB) => (await q<{ stage: string }>("select stage from jobs where id=$1", [job]))[0]!.stage;

beforeAll(async () => {
  const d = core.allowedReadyCheckDays();
  await book(JOB, d[4]!);
  await book(OWN, d[4]!);
});

describe("installer's own customers: no change (no portal booking)", () => {
  test("owner and installer are both refused; nothing written", async () => {
    await expect(rc.ownerChangeReadyCheck(OWN, OWNER)).rejects.toThrow(/own customers/);
    await expect(rc.installerChangeReadyCheck(OWN, INST, { day: core.allowedReadyCheckDays()[5]!, time: "10:00" })).rejects.toThrow(/own customers/);
    expect(await q("select id from bookings where job_id=$1 and status='confirmed'", [OWN])).toHaveLength(1);
    expect(await stage(OWN)).toBe("ready_check_scheduled");
  });
});

describe("installer changes the time → rebooked directly", () => {
  test("state offers Change time with allowed days", async () => {
    const s = await rc.installerReadyCheckState(JOB, INST);
    expect(s).toMatchObject({ turn: "booked", canChange: true });
    expect(s.days.length).toBeGreaterThan(5);
  });
  test("someone else on another business can't", async () => {
    await expect(rc.installerChangeReadyCheck(JOB, OTHER, { day: core.allowedReadyCheckDays()[5]!, time: "10:00" })).rejects.toThrow(/Only the job's installer/);
  });
  test("an invalid time is refused before any booking write", async () => {
    await expect(rc.installerChangeReadyCheck(JOB, INST, { day: core.allowedReadyCheckDays()[5]!, time: "06:00" })).rejects.toThrow(/choose a time/);
    expect(calls.bookings).toHaveLength(0);
  });
  test("new day + time → confirmBooking reschedule, one confirmed booking, owner 'You're booked' hook", async () => {
    const day = core.allowedReadyCheckDays()[6]!;
    const start = core.readyCheckStartAt(day, "10:30").toISOString();
    expect(await rc.installerChangeReadyCheck(JOB, INST, { day, time: "10:30" })).toEqual({ ok: true, booked: true });
    expect(calls.bookings).toEqual([`ready_check|${start}|${INST}|installer (changed time)`]);
    const live = await q<{ scheduled_start: string }>("select scheduled_start::text from bookings where job_id=$1 and status='confirmed'", [JOB]);
    expect(live.map((b) => new Date(b.scheduled_start).toISOString())).toEqual([start]);
    expect(await stage()).toBe("ready_check_scheduled");
    expect(calls.booked).toEqual([start]);
    expect(await q("select id from workflow_events where event_type='ready_check_changed' and details->>'by'='installer'")).toHaveLength(1);
  });
});

describe("owner changes the time → back to the installer to offer 3 new times", () => {
  test("owner state shows Change time", async () => expect(await rc.ownerReadyCheckTimesState(JOB)).toMatchObject({ applies: true, turn: "booked", canChange: true }));
  test("if the stage can't move back, the booking is restored", async () => {
    failTransition = true;
    await expect(rc.ownerChangeReadyCheck(JOB, OWNER)).rejects.toThrow(/Blocked/);
    failTransition = false;
    expect(await q("select id from bookings where job_id=$1 and status='confirmed'", [JOB])).toHaveLength(1);
    expect(await stage()).toBe("ready_check_scheduled");
  });
  test("change → booking cancelled, stage back, installer's move (same installer kept)", async () => {
    expect(await rc.ownerChangeReadyCheck(JOB, OWNER)).toEqual({ ok: true });
    expect(await q("select id from bookings where job_id=$1 and status='confirmed'", [JOB])).toHaveLength(0);
    expect(calls.transitions).toEqual([`${JOB}|ready_check_ready_to_schedule`]);
    expect(await q("select id from job_assignments where job_id=$1 and role='installer' and active", [JOB])).toHaveLength(1);
    const s = await rc.installerReadyCheckState(JOB, INST);
    expect(s).toMatchObject({ turn: "installer_to_offer", canChange: false });
    expect((await rc.ownerReadyCheckTimesState(JOB) as { turn: string }).turn).toBe("installer_to_offer");
    expect(await q("select id from workflow_events where event_type='ready_check_changed' and details->>'by'='owner'")).toHaveLength(1);
    await expect(rc.ownerChangeReadyCheck(JOB, OWNER)).rejects.toThrow(/no booked Ready Check/);
  });
  test("installer offers 3 new times → owner taps one → booked again + owner 'You're booked' hook", async () => {
    const d = core.allowedReadyCheckDays();
    await rc.installerOfferNewTimes(JOB, INST, [d[7]!, d[8]!, d[9]!].map((day) => ({ day, time: "08:00" })));
    const [p] = await q<{ id: string; starts_at: string }>("select id, starts_at::text from appointment_proposals where job_id=$1 and status='proposed' order by starts_at limit 1", [JOB]);
    expect(await rc.ownerTakeReadyCheckTime(JOB, p!.id, OWNER)).toEqual({ ok: true, booked: true });
    const start = new Date(p!.starts_at).toISOString();
    expect(calls.booked.at(-1)).toBe(start);
    expect(await stage()).toBe("ready_check_scheduled");
  });
});
