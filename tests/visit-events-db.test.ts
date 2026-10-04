// Practice database (PGlite) for 0100 visit events. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const JOB = "20000000-0000-4000-8000-000000000001", BK = "30000000-0000-4000-8000-000000000001", B1 = "10000000-0000-4000-8000-000000000001";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE booking_kind AS ENUM ('assessment','rectification','installation','ready_check');
CREATE TABLE public.jobs (id uuid primary key, stage text);
CREATE TABLE public.businesses (id uuid primary key);
CREATE TABLE public.bookings (id uuid primary key, job_id uuid, status text);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
INSERT INTO jobs VALUES ('${JOB}','piesa_scheduled'); INSERT INTO businesses VALUES ('${B1}'); INSERT INTO bookings VALUES ('${BK}','${JOB}','confirmed');
`;
let db: PGlite;
const ins = (event: string, extra = "") => db.exec(`INSERT INTO visit_events (job_id, booking_id, business_id, visit_kind, event, counts_against${extra ? ", clears_event_id" : ""}) VALUES ('${JOB}', ${event === "evidence_rejected" ? "NULL" : `'${BK}'`}, '${B1}', 'assessment', '${event}', 'trade'${extra ? `, '${extra}'` : ""})`);

beforeEach(async () => { db = new PGlite(); await db.exec(BASE); await db.exec(read("0100_visit_events.sql")); });

describe("0100 visit events (practice database)", () => {
  test("existing rows unchanged; running twice is safe", async () => {
    await db.exec(read("0100_visit_events.sql"));
    expect((await db.query(`SELECT stage FROM jobs`)).rows).toEqual([{ stage: "piesa_scheduled" }]);
    expect((await db.query(`SELECT status FROM bookings`)).rows).toEqual([{ status: "confirmed" }]);
    expect((await db.query(`SELECT count(*)::int n FROM visit_events`)).rows).toEqual([{ n: 0 }]);
  });
  test("one no-show per booking; evidence rejections may repeat", async () => {
    await ins("trade_no_show");
    await expect(ins("trade_no_show")).rejects.toThrow();
    await ins("evidence_rejected"); await ins("evidence_rejected");
    expect((await db.query(`SELECT count(*)::int n FROM visit_events`)).rows).toEqual([{ n: 3 }]);
  });
  test("append-only: no edit or delete", async () => {
    await ins("trade_arrived");
    await expect(db.exec(`UPDATE visit_events SET reason='x'`)).rejects.toThrow(/append-only/);
    await expect(db.exec(`DELETE FROM visit_events`)).rejects.toThrow(/append-only/);
  });
  test("clearing a no-show needs a target and happens once; unknown events refused", async () => {
    await ins("trade_no_show");
    const id = (await db.query<{ id: string }>(`SELECT id FROM visit_events`)).rows[0]!.id;
    await expect(db.exec(`INSERT INTO visit_events (job_id,event) VALUES ('${JOB}','no_show_cleared')`)).rejects.toThrow();
    await db.exec(`INSERT INTO visit_events (job_id,event,clears_event_id,reason) VALUES ('${JOB}','no_show_cleared','${id}','Office: trade was onsite')`);
    await expect(db.exec(`INSERT INTO visit_events (job_id,event,clears_event_id) VALUES ('${JOB}','no_show_cleared','${id}')`)).rejects.toThrow();
    await expect(db.exec(`INSERT INTO visit_events (job_id,event) VALUES ('${JOB}','made_up')`)).rejects.toThrow();
  });
  test("rollback removes only the new table", async () => {
    await db.exec(read("0100_visit_events.rollback.sql"));
    expect((await db.query(`SELECT to_regclass('public.visit_events') r`)).rows).toEqual([{ r: null }]);
    expect((await db.query(`SELECT count(*)::int n FROM bookings`)).rows).toEqual([{ n: 1 }]);
  });
});
