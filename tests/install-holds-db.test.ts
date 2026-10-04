// Practice database (PGlite) proof for 0096: additive, one active hold per job, rollback clean. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const JOB = "20000000-0000-4000-8000-000000000001", BIZ = "40000000-0000-4000-8000-000000000001";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ select false $$;
CREATE TABLE public.jobs (id uuid primary key, stage text);
CREATE TABLE public.businesses (id uuid primary key, name text, weekly_capacity int);
INSERT INTO public.jobs VALUES ('${JOB}','piesa_scheduled');
INSERT INTO public.businesses VALUES ('${BIZ}','TEST Installer', 5);`;

let db: PGlite;
const place = (week: string, reason = "created") => db.query(`select public.place_install_hold('${JOB}','${BIZ}',120,'${week}','${reason}') id`);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(BASE);
  await db.exec(read("0096_install_holds.sql"));
  await db.exec(read("0096_install_holds.sql")); // rerun safe
});

describe("0096 install holds (practice database)", () => {
  test("existing rows unchanged; capacity empty", async () => {
    const r = await db.query(`select name, weekly_capacity, daily_capacity_m2 from businesses`);
    expect(r.rows[0]).toEqual({ name: "TEST Installer", weekly_capacity: 5, daily_capacity_m2: null });
  });
  test("capacity must be positive", async () => {
    await expect(db.exec(`update businesses set daily_capacity_m2 = 0`)).rejects.toThrow();
    await db.exec(`update businesses set daily_capacity_m2 = 150`);
  });
  test("placing twice moves the same hold (never two active)", async () => {
    const a = (await place("2026-11-02")).rows[0] as { id: string };
    const b = (await place("2026-11-16", "moved after PIESA")).rows[0] as { id: string };
    expect(a.id).toBe(b.id);
    const r = await db.query(`select count(*)::int n, max(target_week_start)::text w from install_holds where status='active'`);
    expect(r.rows[0]).toEqual({ n: 1, w: "2026-11-16" });
  });
  test("second active hold refused by the database", async () => {
    await place("2026-11-02");
    await expect(db.exec(`insert into install_holds (job_id, target_week_start, reason) values ('${JOB}','2026-11-09','x')`)).rejects.toThrow();
  });
  test("released hold allows a new one later", async () => {
    await place("2026-11-02");
    await db.exec(`update install_holds set status='released', released_at=now()`);
    await place("2026-11-23");
    const r = await db.query(`select count(*)::int n from install_holds`);
    expect(r.rows[0]).toEqual({ n: 2 });
  });
  test("reason required", async () => {
    await expect(place("2026-11-02", " ")).rejects.toThrow("reason");
  });
  test("rollback is clean", async () => {
    await place("2026-11-02");
    await db.exec(read("0096_install_holds.rollback.sql"));
    const t = await db.query(`select count(*)::int n from information_schema.tables where table_name='install_holds'`);
    const c = await db.query(`select count(*)::int n from information_schema.columns where table_name='businesses' and column_name='daily_capacity_m2'`);
    expect([t.rows[0], c.rows[0]]).toEqual([{ n: 0 }, { n: 0 }]);
    const b = await db.query(`select name from businesses`);
    expect(b.rows.length).toBe(1);
  });
});
