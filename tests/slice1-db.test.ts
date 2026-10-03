// Slice 1 practice-database tests. Runs only against in-process PGlite (see helpers/pglite-slice1.ts).
import { describe, expect, test } from "bun:test";
import { ID, SLICE1_ROLLBACK_SQL, SLICE1_SQL, slice1Db } from "./helpers/pglite-slice1";

const JOB = "20000000-0000-4000-8000-000000000001";
const EST = "30000000-0000-4000-8000-000000000001";
const ASSIGN = "40000000-0000-4000-8000-000000000001";

async function migrated(flagsOn = true) {
  const t = await slice1Db();
  await t.db.exec(SLICE1_SQL);
  if (flagsOn) await t.db.exec(`UPDATE public.workflow_settings SET slice1_ready_check_booking_enabled = true, slice1_contact_sharing_enabled = true`);
  return t;
}
const one = async <T,>(t: Awaited<ReturnType<typeof slice1Db>>, sql: string, p: unknown[] = []) => (await t.db.query<T>(sql, p)).rows[0]!;
const fails = async (p: Promise<unknown>, msg: RegExp) => { await expect(p).rejects.toThrow(msg); };
const stage = async (t: Awaited<ReturnType<typeof slice1Db>>) => { await t.reset(); return (await one<{ stage: string }>(t, `SELECT stage::text FROM jobs WHERE id=$1`, [JOB])).stage; };

/** Drives a TEST job up to "time entered by the installer". Returns ids. */
async function toTimeEntered(t: Awaited<ReturnType<typeof slice1Db>>) {
  await t.reset();
  const upd = (await one<{ u: string }>(t, `SELECT updated_at::text u FROM jobs WHERE id=$1`, [JOB])).u;
  await t.as(ID.office);
  const approval = (await one<{ a: string }>(t, `SELECT rc_approve_estimate($1,$2,$3,'TEST approve') a`, [JOB, EST, upd])).a;
  const request = (await one<{ r: string }>(t, `SELECT rc_request_ready_check($1,$2,'office_recorded','consent-v1','TEST phone call','idem-1') r`, [JOB, approval])).r;
  const visit = (await one<{ v: string }>(t, `SELECT rc_open_visit($1,$2) v`, [request, ASSIGN])).v;
  await t.as(ID.ownerUser);
  await t.db.query(`SELECT rc_release_contacts($1,'owner','notice-v1','owner_request','consent-v1')`, [visit]);
  await t.as(ID.installer);
  await t.db.query(`SELECT rc_release_contacts($1,'trade','notice-v1','assignment','consent-v1')`, [visit]);
  const proposal = (await one<{ p: string }>(t, `SELECT rc_enter_time($1, now() + interval '3 days', now() + interval '3 days 1 hour','trade',NULL) p`, [visit])).p;
  return { approval, request, visit, proposal };
}

describe("Slice 1 migration on the practice database", () => {
  test("applies cleanly, changes no existing rows, flags default OFF", async () => {
    const t = await slice1Db();
    const before = await one<{ j: number; e: number }>(t, `SELECT (SELECT count(*) FROM jobs)::int j, (SELECT count(*) FROM workflow_events)::int e`);
    await t.db.exec(SLICE1_SQL);
    const after = await one<{ j: number; e: number; f1: boolean; f2: boolean }>(t,
      `SELECT (SELECT count(*) FROM jobs)::int j, (SELECT count(*) FROM workflow_events)::int e, slice1_ready_check_booking_enabled f1, slice1_contact_sharing_enabled f2 FROM workflow_settings`);
    expect(after.j).toBe(before.j);
    expect(after.e).toBe(before.e);
    expect(after.f1).toBe(false);
    expect(after.f2).toBe(false);
    const tables = (await t.db.query<{ t: string }>(`SELECT tablename t FROM pg_tables WHERE schemaname='public' AND rowsecurity ORDER BY 1`)).rows.map((r) => r.t);
    expect(tables).toEqual(["contact_disclosures", "estimate_approvals", "ready_check_requests", "visit_task_recipients", "visit_tasks", "visits"]);
  });

  test("with flags OFF every new action refuses and legacy stage moves are unchanged", async () => {
    const t = await migrated(false);
    await t.as(ID.office);
    await fails(t.db.query(`SELECT rc_approve_estimate($1,$2,now(),'x')`, [JOB, EST]), /switched off/);
    await t.reset();
    await t.db.query(`UPDATE jobs SET stage='ready_check_scheduled' WHERE id=$1`, [JOB]);
    expect(await stage(t)).toBe("ready_check_scheduled");
  });

  test("rollback removes everything added and keeps existing rows; migration re-applies", async () => {
    const t = await migrated();
    await t.db.exec(SLICE1_ROLLBACK_SQL);
    const r = await one<{ n: number; j: number; c: number; f: number }>(t, `SELECT
      (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename IN ('visits','contact_disclosures','estimate_approvals','ready_check_requests','visit_tasks','visit_task_recipients'))::int n,
      (SELECT count(*) FROM jobs)::int j,
      (SELECT count(*) FROM information_schema.columns WHERE table_name IN ('appointment_proposals','workflow_settings') AND column_name IN ('visit_id','version','entered_by_party','office_evidence','slice1_ready_check_booking_enabled','slice1_contact_sharing_enabled'))::int c,
      (SELECT count(*) FROM pg_proc WHERE proname LIKE 'rc\\_%' OR proname LIKE 'slice1\\_%')::int f`);
    expect(r).toEqual({ n: 0, j: 2, c: 0, f: 0 });
    await t.db.exec(SLICE1_SQL);
  });
});

describe("Booking only happens on confirmation by the other party or office", () => {
  test("opening, sharing contacts, reminders and entering a time do not book", async () => {
    const t = await migrated();
    const { visit } = await toTimeEntered(t);
    await t.reset();
    const v = await one<{ status: string; tasks: number }>(t, `SELECT status, (SELECT count(*) FROM visit_tasks WHERE visit_id=$1 AND status='pending')::int tasks FROM visits WHERE id=$1`, [visit]);
    expect(v.status).toBe("time_entered");
    expect(v.tasks).toBe(1); // 48h office alert still pending; 24h reminder cancelled by time entry
    // a reminder "sent" is just a recipient row; it never touches the visit
    await t.db.query(`INSERT INTO visit_task_recipients(task_id, recipient_role, outcome) SELECT id,'owner','suppressed' FROM visit_tasks WHERE visit_id=$1 AND kind='reminder_24h'`, [visit]);
    expect((await one<{ status: string }>(t, `SELECT status FROM visits WHERE id=$1`, [visit])).status).toBe("time_entered");
    expect(await stage(t)).toBe("ready_check_ready_to_schedule");
  });

  test("database rule: job cannot become Ready Check scheduled without a confirmed visit for the current installer", async () => {
    const t = await migrated();
    await toTimeEntered(t);
    await t.reset();
    await fails(t.db.query(`UPDATE jobs SET stage='ready_check_scheduled' WHERE id=$1`, [JOB]), /not confirmed for the current assignment/);
  });

  test("the party who entered the time, an unrelated user and a different installer cannot confirm", async () => {
    const t = await migrated();
    const { visit, proposal } = await toTimeEntered(t);
    await t.as(ID.installer);
    await fails(t.db.query(`SELECT rc_confirm_time($1,$2,1,'trade',NULL)`, [visit, proposal]), /other party must confirm/);
    await t.as(ID.stranger);
    await fails(t.db.query(`SELECT rc_confirm_time($1,$2,1,'owner',NULL)`, [visit, proposal]), /Only the owner/);
    await t.as(ID.installer2);
    await fails(t.db.query(`SELECT rc_confirm_time($1,$2,1,'office','x')`, [visit, proposal]), /admin and evidence/);
    await t.as(ID.office);
    await fails(t.db.query(`SELECT rc_confirm_time($1,$2,1,'office','')`, [visit, proposal]), /admin and evidence/);
  });

  test("owner confirmation books; then the stage move is allowed", async () => {
    const t = await migrated();
    const { visit, proposal } = await toTimeEntered(t);
    await t.as(ID.ownerUser);
    await t.db.query(`SELECT rc_confirm_time($1,$2,1,'owner',NULL)`, [visit, proposal]);
    await t.reset();
    expect((await one<{ status: string }>(t, `SELECT status FROM visits WHERE id=$1`, [visit])).status).toBe("confirmed");
    await t.db.query(`UPDATE jobs SET stage='ready_check_scheduled' WHERE id=$1`, [JOB]);
    expect(await stage(t)).toBe("ready_check_scheduled");
  });

  test("office confirmation with recorded evidence books", async () => {
    const t = await migrated();
    const { visit, proposal } = await toTimeEntered(t);
    await t.as(ID.office);
    await t.db.query(`SELECT rc_confirm_time($1,$2,1,'office','TEST: owner confirmed by phone')`, [visit, proposal]);
    await t.reset();
    expect((await one<{ status: string }>(t, `SELECT status FROM visits WHERE id=$1`, [visit])).status).toBe("confirmed");
  });

  test("a reassigned installer's confirmed visit does not satisfy the rule", async () => {
    const t = await migrated();
    const { visit, proposal } = await toTimeEntered(t);
    await t.as(ID.ownerUser);
    await t.db.query(`SELECT rc_confirm_time($1,$2,1,'owner',NULL)`, [visit, proposal]);
    await t.reset();
    await t.db.query(`UPDATE job_assignments SET active=false WHERE id=$1`, [ASSIGN]);
    await fails(t.db.query(`UPDATE jobs SET stage='ready_check_scheduled' WHERE id=$1`, [JOB]), /not confirmed/);
  });
});

describe("Access rules (RLS + grants) for office, owner, installer, electrician, unrelated user", () => {
  test("each role sees only what it should", async () => {
    const t = await migrated();
    await toTimeEntered(t);
    const counts = async (u: string) => {
      await t.as(u);
      return one<{ v: number; d: number; a: number; k: number }>(t, `SELECT (SELECT count(*) FROM visits)::int v, (SELECT count(*) FROM contact_disclosures)::int d,
        (SELECT count(*) FROM estimate_approvals)::int a, (SELECT count(*) FROM visit_tasks)::int k`);
    };
    expect(await counts(ID.office)).toEqual({ v: 1, d: 2, a: 1, k: 2 });
    expect(await counts(ID.ownerUser)).toEqual({ v: 1, d: 1, a: 0, k: 0 });
    expect(await counts(ID.installer)).toEqual({ v: 1, d: 1, a: 0, k: 0 });
    expect(await counts(ID.electrician)).toEqual({ v: 0, d: 0, a: 0, k: 0 });
    expect(await counts(ID.stranger)).toEqual({ v: 0, d: 0, a: 0, k: 0 });
  });

  test("signed-in users cannot write the new tables directly; anon cannot read them", async () => {
    const t = await migrated();
    await t.as(ID.office);
    await fails(t.db.query(`INSERT INTO visits(job_id, request_id, assignment_id) VALUES ($1, gen_random_uuid(), $2)`, [JOB, ASSIGN]), /permission denied/);
    await t.reset();
    await t.db.exec(`SET ROLE anon`);
    await fails(t.db.query(`SELECT * FROM visits`), /permission denied/);
    await t.reset();
  });

  test("office-only database actions refuse non-office callers", async () => {
    const t = await migrated();
    for (const u of [ID.ownerUser, ID.installer, ID.electrician, ID.stranger]) {
      await t.as(u);
      await fails(t.db.query(`SELECT rc_approve_estimate($1,$2,now(),'x')`, [JOB, EST]), /Admin only/);
      await fails(t.db.query(`SELECT rc_open_visit(gen_random_uuid(),$1)`, [ASSIGN]), /Admin only/);
      await fails(t.db.query(`SELECT rc_request_ready_check($1,gen_random_uuid(),'office_recorded','c','e','k-${u}')`, [JOB]), /Admin only/);
    }
  });

  test("contact sharing is off unless its own switch is on", async () => {
    const t = await migrated();
    await t.reset();
    await t.db.exec(`UPDATE workflow_settings SET slice1_contact_sharing_enabled=false`);
    await t.as(ID.ownerUser);
    await fails(t.db.query(`SELECT rc_release_contacts(gen_random_uuid(),'owner','n','b','c')`), /Contact sharing is switched off/);
  });
});
