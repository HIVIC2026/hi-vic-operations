// Practice database (PGlite) proof for 0098: additive, append-only, level check, rollback clean. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const JOB = "20000000-0000-4000-8000-000000000001", CERT = "70000000-0000-4000-8000-000000000001", U = "30000000-0000-4000-8000-000000000001";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS 'select false';
CREATE TABLE public.jobs (id uuid primary key);
CREATE TABLE public.partner_worker_certifications (id uuid primary key, worker_email text not null, status text not null);
INSERT INTO public.jobs VALUES ('${JOB}');
INSERT INTO public.partner_worker_certifications VALUES ('${CERT}','lead@test.example','verified');`;

let db: PGlite;
const apply = () => db.exec(read("0098_prestart_checks.sql"));
beforeEach(async () => { db = new PGlite(); await db.exec(BASE); });

describe("0098 pre-start checks (practice database)", () => {
  test("existing certification unchanged; new tables empty; running twice is safe", async () => {
    await apply(); await apply();
    expect((await db.query(`SELECT status FROM public.partner_worker_certifications`)).rows).toEqual([{ status: "verified" }]);
    expect((await db.query<{ n: number }>(`SELECT (SELECT count(*) FROM public.worker_certification_levels)::int + (SELECT count(*) FROM public.pre_start_checks)::int AS n`)).rows[0]!.n).toBe(0);
  });
  test("level must be full or provisional, expiry required", async () => {
    await apply();
    await db.exec(`INSERT INTO public.worker_certification_levels (certification_id, worker_email, level, expires_on, recorded_by) VALUES ('${CERT}','lead@test.example','full','2027-06-30','${U}')`);
    await expect(db.exec(`INSERT INTO public.worker_certification_levels (certification_id, worker_email, level, expires_on, recorded_by) VALUES ('${CERT}','x','partial','2027-06-30','${U}')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO public.worker_certification_levels (certification_id, worker_email, level, recorded_by) VALUES ('${CERT}','x','full','${U}')`)).rejects.toThrow();
  });
  test("records are permanent (no edit, no delete)", async () => {
    await apply();
    await db.exec(`INSERT INTO public.pre_start_checks (job_id, scheduled_start, passed, failures, trigger) VALUES ('${JOB}', now(), false, '["x"]', 'noon')`);
    await db.exec(`INSERT INTO public.worker_certification_levels (certification_id, worker_email, level, expires_on, recorded_by) VALUES ('${CERT}','lead@test.example','full','2027-06-30','${U}')`);
    await expect(db.exec(`UPDATE public.pre_start_checks SET passed = true`)).rejects.toThrow("permanent");
    await expect(db.exec(`DELETE FROM public.pre_start_checks`)).rejects.toThrow("permanent");
    await expect(db.exec(`UPDATE public.worker_certification_levels SET level = 'provisional'`)).rejects.toThrow("permanent");
  });
  test("rollback is clean", async () => {
    await apply(); await db.exec(read("0098_prestart_checks.rollback.sql"));
    const n = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('pre_start_checks','worker_certification_levels')`)).rows[0]!.n;
    expect(n).toBe(0);
    expect((await db.query(`SELECT status FROM public.partner_worker_certifications`)).rows).toEqual([{ status: "verified" }]);
  });
});
