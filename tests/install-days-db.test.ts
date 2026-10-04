// Practice database (PGlite) proof for 0097: additive, first tap wins, 30-day hard gate, rollback clean. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const JOB = "20000000-0000-4000-8000-000000000001", JOB2 = "20000000-0000-4000-8000-000000000002";
const ASG = "40000000-0000-4000-8000-000000000001", ASG_E = "40000000-0000-4000-8000-000000000002", USER = "30000000-0000-4000-8000-000000000001";
const D1 = "60000000-0000-4000-8000-000000000001", D2 = "60000000-0000-4000-8000-000000000002", D3 = "60000000-0000-4000-8000-000000000003", OLD = "60000000-0000-4000-8000-000000000009";
const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE booking_kind AS ENUM ('assessment','rectification','installation','ready_check');
CREATE TYPE booking_status AS ENUM ('proposed','confirmed','completed','cancelled');
CREATE TYPE assignment_role AS ENUM ('electrician','installer','property_manager');
CREATE TABLE public.jobs (id uuid primary key, job_number text);
CREATE TABLE public.job_assignments (id uuid primary key, job_id uuid not null, role assignment_role not null, active boolean not null default true);
CREATE TABLE public.bookings (id serial primary key, job_id uuid not null, kind booking_kind not null, status booking_status not null);
CREATE TABLE public.workflow_events (id serial primary key, job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean);
CREATE TABLE public.appointment_proposals (id uuid primary key, job_id uuid not null, kind booking_kind not null, status text not null default 'proposed',
  starts_at timestamptz not null, assignment_id uuid, responded_by uuid, responded_at timestamptz, response_note text);
INSERT INTO public.jobs VALUES ('${JOB}','TEST-1'),('${JOB2}','TEST-2');
INSERT INTO public.job_assignments VALUES ('${ASG}','${JOB}','installer',true),('${ASG_E}','${JOB}','electrician',true);
INSERT INTO public.appointment_proposals (id, job_id, kind, starts_at) VALUES ('${OLD}','${JOB}','installation', now() + interval '3 days');`;

let db: PGlite;
const days = (n: number) => `now() + interval '${n} days'`;
async function apply() { await db.exec(read("0097_install_days.sql")); }
async function seedDays() {
  await db.exec(`INSERT INTO public.appointment_proposals (id, job_id, kind, starts_at, install_day) VALUES
    ('${D1}','${JOB}','installation',${days(5)},true),('${D2}','${JOB}','installation',${days(6)},true),('${D3}','${JOB}','installation',${days(40)},true);`);
}
const deadline = "(now() + interval '20 days')::date";
const take = async (p: string, a = ASG, dl = deadline) => (await db.query<{ r: string }>(`SELECT public.accept_install_day('${p}','${a}','${USER}',${dl}) AS r`)).rows[0]!.r;

beforeEach(async () => { db = new PGlite(); await db.exec(BASE); });

describe("0097 install days (practice database)", () => {
  test("existing rows unchanged; new fields empty; running twice is safe", async () => {
    await apply(); await apply();
    const r = (await db.query<{ install_day: boolean; status: string }>(`SELECT install_day, status FROM public.appointment_proposals WHERE id='${OLD}'`)).rows[0]!;
    expect(r).toEqual({ install_day: false, status: "proposed" });
    const j = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.jobs WHERE install_10day_flagged_at IS NOT NULL`)).rows[0]!;
    expect(j.n).toBe(0);
  });
  test("first tap books; other days close; second tap refused", async () => {
    await apply(); await seedDays();
    expect(await take(D1)).toBe("accepted");
    const s = (await db.query<{ id: string; status: string }>(`SELECT id, status FROM public.appointment_proposals ORDER BY id`)).rows;
    expect(s.find((x) => x.id === D1)!.status).toBe("accepted");
    expect(s.find((x) => x.id === D2)!.status).toBe("superseded");
    expect(s.find((x) => x.id === OLD)!.status).toBe("proposed"); // ordinary proposals untouched
    expect(await take(D2)).toBe("day_unavailable");
  });
  test("a day after the 30-day deadline is refused (hard gate)", async () => {
    await apply(); await seedDays();
    expect(await take(D3)).toBe("outside_window");
    expect(await take(D1, ASG, "NULL")).toBe("outside_window");
  });
  test("only the job's active installer can take a day; ordinary proposals can't be taken", async () => {
    await apply(); await seedDays();
    expect(await take(D1, ASG_E)).toBe("not_installer");
    expect(await take(OLD)).toBe("not_found");
    await db.exec(`UPDATE public.job_assignments SET active=false WHERE id='${ASG}'`);
    expect(await take(D1)).toBe("not_installer");
  });
  test("an existing confirmed install booking blocks a second booking", async () => {
    await apply(); await seedDays();
    await db.exec(`INSERT INTO public.bookings (job_id, kind, status) VALUES ('${JOB}','installation','confirmed')`);
    expect(await take(D1)).toBe("already_booked");
  });
  test("rollback is clean", async () => {
    await apply(); await db.exec(read("0097_install_days.rollback.sql"));
    const c = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM information_schema.columns WHERE column_name IN ('install_day','install_10day_flagged_at')`)).rows[0]!;
    expect(c.n).toBe(0);
    const f = (await db.query<{ n: number }>(`SELECT count(*)::int n FROM pg_proc WHERE proname='accept_install_day'`)).rows[0]!;
    expect(f.n).toBe(0);
  });
});
