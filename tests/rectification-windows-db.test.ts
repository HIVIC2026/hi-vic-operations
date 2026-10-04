// Practice database (PGlite) proof for 0095: additive, approve+pick is all-or-nothing, rollback clean. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const JOB = "20000000-0000-4000-8000-000000000001", Q = "50000000-0000-4000-8000-000000000001", OWNER = "30000000-0000-4000-8000-000000000001";
const P1 = "60000000-0000-4000-8000-000000000001", P2 = "60000000-0000-4000-8000-000000000002", PSOON = "60000000-0000-4000-8000-000000000003", OLD = "60000000-0000-4000-8000-000000000009";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE booking_kind AS ENUM ('assessment','rectification','installation','ready_check');
CREATE TYPE quote_status AS ENUM ('draft','issued','accepted','declined','superseded','expired');
CREATE TYPE quote_kind AS ENUM ('installation','rectification');
CREATE TABLE public.quotes (id uuid primary key, job_id uuid not null, kind quote_kind not null, status quote_status not null, accepted_at timestamptz, accepted_by uuid);
CREATE TABLE public.appointment_proposals (id uuid primary key, job_id uuid not null, kind booking_kind not null, status text not null default 'proposed',
  starts_at timestamptz not null, responded_by uuid, responded_at timestamptz, response_note text);
INSERT INTO public.quotes VALUES ('${Q}','${JOB}','rectification','issued',null,null);
INSERT INTO public.appointment_proposals (id, job_id, kind, starts_at) VALUES ('${OLD}','${JOB}','rectification', now() + interval '3 days');`;

let db: PGlite;
const pick = (p: string) => db.query(`select public.approve_rectification_with_window('${Q}','${p}','${OWNER}') id`);
const status = async (id: string) => (await db.query<{ status: string }>(`select status from appointment_proposals where id='${id}'`)).rows[0]!.status;
const qstatus = async () => (await db.query<{ status: string }>(`select status::text from quotes where id='${Q}'`)).rows[0]!.status;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(BASE);
  await db.exec(read("0095_rectification_windows.sql"));
  await db.exec(read("0095_rectification_windows.sql")); // rerun safe
  await db.exec(`INSERT INTO appointment_proposals (id, job_id, kind, starts_at, electrician_window) VALUES
    ('${P1}','${JOB}','rectification', now() + interval '3 days', true),
    ('${P2}','${JOB}','rectification', now() + interval '4 days', true),
    ('${PSOON}','${JOB}','rectification', now() + interval '20 hours', true)`);
});

describe("0095 rectification windows (practice database)", () => {
  test("existing rows unchanged: new fields empty / false", async () => {
    const q = await db.query<{ h: null; n: null }>(`select rect_estimated_hours h, nudge_24h_at n from quotes`);
    expect(q.rows[0]).toEqual({ h: null, n: null });
    const p = await db.query<{ w: boolean; s: string }>(`select electrician_window w, status s from appointment_proposals where id='${OLD}'`);
    expect(p.rows[0]).toEqual({ w: false, s: "proposed" });
  });
  test("approve + pick in one step; other windows closed; old non-window proposal untouched", async () => {
    await pick(P1);
    expect(await qstatus()).toBe("accepted");
    expect(await status(P1)).toBe("accepted");
    expect(await status(P2)).toBe("superseded");
    expect(await status(OLD)).toBe("proposed");
  });
  test("second pick refused (quote no longer open)", async () => {
    await pick(P1);
    await expect(pick(P2)).rejects.toThrow("no longer open");
  });
  test("window under 24 hours away refused and NOTHING is saved", async () => {
    await expect(pick(PSOON)).rejects.toThrow("24 hours");
    expect(await qstatus()).toBe("issued");
    expect(await status(PSOON)).toBe("proposed");
  });
  test("non-electrician-window time refused", async () => {
    await expect(pick(OLD)).rejects.toThrow("not one of the electrician");
    expect(await qstatus()).toBe("issued");
  });
  test("hours range enforced; rollback clean", async () => {
    await expect(db.exec(`update quotes set rect_estimated_hours = 0`)).rejects.toThrow();
    await db.exec(`update quotes set rect_estimated_hours = 3.5`);
    await db.exec(read("0095_rectification_windows.rollback.sql"));
    const c = await db.query(`select column_name from information_schema.columns where column_name in ('rect_estimated_hours','nudge_24h_at','electrician_window')`);
    expect(c.rows.length).toBe(0);
    const f = await db.query(`select 1 from pg_proc where proname='approve_rectification_with_window'`);
    expect(f.rows.length).toBe(0);
  });
});
