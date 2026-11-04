// G7 (Jo 4 Nov 2026, pack 2 batch 4): a Ready Check can be booked with "Not sure yet" for who's going. The atomic writer
// (docs/pending-migrations/2026-11-04_commit_in_house_visit_v2.sql, `commit_in_house_visit`) proven on a practice Postgres
// (PGlite) with every portal table: NULL `_worker` on a ready_check → the booking, a `ready_check_person_pending` row, saved
// work with no person (no form, no owner notice); NULL on any other kind → refused; picking the person = the same call with
// the worker → re-recorded with "who's going picked", `visit_allocated`, saved work carrying the person. Never the live database.
import { afterAll, describe, expect, test } from "bun:test";
import { journeyDb } from "./helpers/pglite-journey-db";
import { loadPendingFunctions } from "./helpers/journey-harness";

const j = await journeyDb();
const q = j.q;
afterAll(async () => { await j.db.close(); });
const fns = await loadPendingFunctions(j, ["commit_in_house_visit", "in_house_visit_revision", "commit_guarded_stage", "allocate_team_electrician"]);

const BIZ = "20000000-0000-4000-8000-0000000000b1", BOSS = "30000000-0000-4000-8000-0000000000a1", WORKER = "40000000-0000-4000-8000-0000000000c1";
const JOB = "10000000-0000-4000-8000-0000000000e1", OWNER = "50000000-0000-4000-8000-0000000000d1", PROP = "60000000-0000-4000-8000-0000000000f1";
const START = new Date(Date.now() + 3 * 86_400_000).toISOString();
const WORK1 = "70000000-0000-4000-8000-000000000001", WORK2 = "70000000-0000-4000-8000-000000000002", WORK3 = "70000000-0000-4000-8000-000000000003";

await q(`insert into businesses (id, name, business_type, capabilities, is_active, onboarding_status, in_house) values ($1,'TEST Journey Insulation','eec_installer','{installer}',true,'approved',true)`, [BIZ]);
await q(`insert into profiles (id, full_name, email) values ($1,'Ivy Installer','ivy@hivic-test.example')`, [BOSS]);
await q(`insert into business_members (business_id, user_id, member_role, active) values ($1,$2,'business_admin',true)`, [BIZ, BOSS]);
await q(`insert into partner_workers (id, business_id, trade_role, full_legal_name, mobile, account_status, approval_status) values ($1,$2,'installer','Will Casdorff','0477 511 901','active','approved')`, [WORKER, BIZ]);
await q(`insert into owners (id, full_name, email, phone) values ($1,'Helen Journey','helen@hivic-test.example','0477 511 901')`, [OWNER]);
await q(`insert into properties (id, address_line, suburb, state, postcode) values ($1,'1 Journey Street','Frankston','VIC','3199')`, [PROP]);
await q(`insert into jobs (id, job_number, owner_id, property_id, stage, channel, source, originating_installer_business_id) values ($1,'HV-9001',$2,$3,'ready_check_ready_to_schedule','installer_sourced','qa_test',$4)`, [JOB, OWNER, PROP, BIZ]);
await q(`insert into job_assignments (job_id, business_id, user_id, role, active) values ($1,$2,$3,'installer',true)`, [JOB, BIZ, BOSS]);

const job = async () => (await q<{ stage: string; updated_at: Date }>("select stage, updated_at from jobs where id=$1", [JOB]))[0]!;
const revision = async () => (await q<{ r: string }>("select public.in_house_visit_revision($1) r", [JOB]))[0]!.r;
const commit = async (worker: string | null, work: string, booking: string | null) => {
  const jj = await job();
  return (await q<{ r: { bookingId: string | null; workId: string; already: boolean } }>(
    "select public.commit_in_house_visit($1,$2,'ready_check',$3,$4,$5,$6,$7,null,null,$8,$9) r",
    [JOB, BOSS, START, worker, jj.stage, jj.updated_at.toISOString(), booking, JSON.stringify({ needsVerification: [], staff: [], revision: await revision() }), work],
  ))[0]!.r;
};
const events = (type: string) => q<{ summary: string; details: Record<string, unknown> }>("select summary, details from workflow_events where job_id=$1 and event_type=$2 order by created_at", [JOB, type]);

describe("commit_in_house_visit v2: a Ready Check with nobody picked", () => {
  test("the functions compiled", () => { expect(fns.loaded).toContain("commit_in_house_visit"); });
  test("NULL worker on a ready_check → booked; ready_check_person_pending names the booking; saved work has no person; no visit_allocated", async () => {
    const r = await commit(null, WORK1, null);
    expect(r.already).toBe(false);
    expect(r.bookingId).toBeTruthy();
    expect((await job()).stage).toBe("ready_check_scheduled");
    const pend = await events("ready_check_person_pending");
    expect(pend).toHaveLength(1);
    expect(pend[0]!.details["booking_id"]).toBe(r.bookingId);
    expect(await events("visit_allocated")).toHaveLength(0);
    const work = await events("in_house_saved_work");
    expect(work).toHaveLength(1);
    expect(work[0]!.details["workerId"]).toBeNull();
    expect(work[0]!.details["who"]).toBeNull();
    expect(work[0]!.details).toMatchObject({ kind: "ready_check", bookingId: r.bookingId, status: "pending" });
    // the same "Not sure yet" again at the same time is a replay (nothing new)
    const again = await commit(null, WORK1, r.bookingId);
    expect(again).toMatchObject({ already: true, bookingId: r.bookingId });
    expect(await events("ready_check_person_pending")).toHaveLength(1);
  });
  test("picking the person = the same call with the worker: a new booking at the same time, 'who's going picked' history, visit_allocated, saved work with the person", async () => {
    const before = (await q<{ id: string }>("select id from bookings where job_id=$1 and kind='ready_check' and status='confirmed'", [JOB]))[0]!.id;
    const r = await commit(WORKER, WORK2, before);
    expect(r.already).toBe(false);
    expect(r.bookingId).not.toBe(before);
    const bks = await q<{ id: string; status: string; scheduled_start: Date }>("select id, status, scheduled_start from bookings where job_id=$1 and kind='ready_check' order by created_at", [JOB]);
    expect(bks.map((b) => b.status)).toEqual(["cancelled", "confirmed"]);
    expect(bks[1]!.scheduled_start.toISOString()).toBe(START);
    const resch = await events("booking_rescheduled");
    expect(resch).toHaveLength(1);
    expect(resch[0]!.summary).toBe("Ready Check: who's going picked (Will Casdorff)");
    expect(resch[0]!.details["person_picked"]).toBe(true);
    const alloc = await events("visit_allocated");
    expect(alloc).toHaveLength(1);
    expect(alloc[0]!.details).toMatchObject({ visit: "ready_check", worker_id: WORKER, worker_name: "Will Casdorff" });
    const work = await events("in_house_saved_work");
    expect(work).toHaveLength(2);
    expect(work[1]!.details).toMatchObject({ workerId: WORKER, bookingId: r.bookingId, who: { id: WORKER, name: "Will Casdorff" } });
    // the pure state reader agrees: pending on the old booking, picked on the new one
    const { readyCheckPersonState } = await import("../src/lib/ready-check-person.core");
    const evs = (await q<{ event_type: string; details: unknown; created_at: Date }>("select event_type, details, created_at from workflow_events where job_id=$1", [JOB])).map((e) => ({ ...e, created_at: e.created_at.toISOString() }));
    expect(readyCheckPersonState(evs, r.bookingId)).toEqual({ pending: false, name: "Will Casdorff" });
  });
  test("NULL worker on any other kind is refused before anything is written", async () => {
    await q("update jobs set stage='piesa_and_install_window_pending' where id=$1", [JOB]);
    const jj = await job();
    await expect(q("select public.commit_in_house_visit($1,$2,'assessment',$3,null,$4,$5,null,null,null,$6,$7)", [JOB, BOSS, START, jj.stage, jj.updated_at.toISOString(), JSON.stringify({ revision: await revision() }), WORK3])).rejects.toThrow(/Choose the person going/);
    expect(await q("select id from bookings where job_id=$1 and kind='assessment'", [JOB])).toHaveLength(0);
  });
});
