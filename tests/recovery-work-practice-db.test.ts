// Proves docs/pending-migrations/recovery-work.sql on PGlite (in-memory, fake TEST rows).
import { describe, expect, test } from "bun:test";
import { RW_JOB, asRole, recoveryDb } from "./helpers/pglite-recovery-work";
import { RECOVERY_ROLLBACK_SQL } from "./helpers/pglite-recovery-work";

const ins = (db: Awaited<ReturnType<typeof recoveryDb>>, key: string) =>
  db.exec(`INSERT INTO public.recovery_work (kind, work_key, job_id) VALUES ('veec_final_copy', '${key}', '${RW_JOB}')`);

describe("recovery_work SQL", () => {
  test("applies and rolls back cleanly", async () => {
    const db = await recoveryDb();
    const has = async () =>
      (await db.query<{ n: number }>(`SELECT count(*)::int n FROM pg_class WHERE relname='recovery_work'`)).rows[0].n;
    expect(await has()).toBe(1);
    await db.exec(RECOVERY_ROLLBACK_SQL);
    expect(await has()).toBe(0);
    const fn = await db.query<{ n: number }>(`SELECT count(*)::int n FROM pg_proc WHERE proname='claim_recovery_work'`);
    expect(fn.rows[0].n).toBe(0);
  });

  test("duplicate (kind, work_key) is refused with 23505", async () => {
    const db = await recoveryDb();
    await ins(db, "k1");
    let code = "";
    try { await ins(db, "k1"); } catch (e) { code = (e as { code?: string }).code ?? ""; }
    expect(code).toBe("23505");
  });

  test("two claims are disjoint (PGlite is single-connection: the lease from claim 1 hides the rows from claim 2)", async () => {
    const db = await recoveryDb();
    await ins(db, "a"); await ins(db, "b"); await ins(db, "c");
    const claim = (n: number) => asRole(db, "service_role", async () =>
      (await db.query<{ work_key: string }>(`SELECT * FROM public.claim_recovery_work(${n}, 300)`)).rows.map((r) => r.work_key));
    const first = await claim(2);
    const second = await claim(10);
    expect(first.length).toBe(2);
    expect(second.length).toBe(1);
    expect(second.filter((k) => first.includes(k))).toEqual([]);
    expect([...first, ...second].sort()).toEqual(["a", "b", "c"]);
  });

  test("an expired lease is reclaimable", async () => {
    const db = await recoveryDb();
    await ins(db, "a");
    const claim = () => asRole(db, "service_role", async () =>
      (await db.query(`SELECT * FROM public.claim_recovery_work(5, 300)`)).rows.length);
    expect(await claim()).toBe(1);
    expect(await claim()).toBe(0);
    await db.exec(`UPDATE public.recovery_work SET next_attempt_at = now() - interval '1 second'`);
    expect(await claim()).toBe(1);
  });

  test("done and needs_office items are not claimed", async () => {
    const db = await recoveryDb();
    await ins(db, "a"); await ins(db, "b");
    await db.exec(`UPDATE public.recovery_work SET status='done' WHERE work_key='a'; UPDATE public.recovery_work SET status='needs_office' WHERE work_key='b'`);
    const n = await asRole(db, "service_role", async () => (await db.query(`SELECT * FROM public.claim_recovery_work(5, 300)`)).rows.length);
    expect(n).toBe(0);
  });

  test("invalid kind or status is refused (23514)", async () => {
    const db = await recoveryDb();
    for (const sql of [
      `INSERT INTO public.recovery_work (kind, work_key) VALUES ('nope','x')`,
      `INSERT INTO public.recovery_work (kind, work_key, status) VALUES ('veec_final_copy','x','bad')`,
    ]) {
      let code = "";
      try { await db.exec(sql); } catch (e) { code = (e as { code?: string }).code ?? ""; }
      expect(code).toBe("23514");
    }
  });

  test("authenticated and anon cannot read or claim; service_role can read", async () => {
    const db = await recoveryDb();
    await ins(db, "a");
    for (const role of ["authenticated", "anon"]) {
      let code = "";
      try { await asRole(db, role, () => db.query(`SELECT * FROM public.recovery_work`)); } catch (e) { code = (e as { code?: string }).code ?? ""; }
      expect(code).toBe("42501");
      code = "";
      try { await asRole(db, role, () => db.query(`SELECT * FROM public.claim_recovery_work(1, 60)`)); } catch (e) { code = (e as { code?: string }).code ?? ""; }
      expect(code).toBe("42501");
    }
    const n = await asRole(db, "service_role", async () => (await db.query(`SELECT * FROM public.recovery_work`)).rows.length);
    expect(n).toBe(1);
  });

  test("deleting the job keeps the item (job_id set null)", async () => {
    const db = await recoveryDb();
    await ins(db, "a");
    await db.exec(`DELETE FROM public.jobs`);
    const r = await db.query<{ job_id: string | null }>(`SELECT job_id FROM public.recovery_work`);
    expect(r.rows[0].job_id).toBeNull();
  });
});
