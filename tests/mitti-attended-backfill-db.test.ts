import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Staged one-off: installer jobs whose Mitti Ready Check finished before the "attended" change get Attended = Yes,
// and priced ones get "quote prepared". Proven on PGlite with minimal copies of jobs + workflow_events.
const sql = readFileSync(new URL("../docs/pending-migrations/mitti-ready-check-attended-backfill.sql", import.meta.url), "utf8");
const J = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const DONE_AT = "2026-10-27 22:19:56+00"; // Melbourne: 28 Oct 2026

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.jobs (id uuid primary key, job_number text, channel text, deleted_at timestamptz,
      installer_site_check text, installer_site_check_date date, installer_quoted text);
    CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id),
      actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb,
      internal boolean not null default false, created_at timestamptz not null default now());
    INSERT INTO public.jobs (id, job_number, channel, deleted_at, installer_site_check, installer_quoted) VALUES
      ('${J(1)}', 'A', 'installer_sourced', null, 'no', 'no'),
      ('${J(2)}', 'B', 'installer_sourced', null, null, null),
      ('${J(3)}', 'C', 'hivic_sourced', null, 'no', null),
      ('${J(4)}', 'D', 'installer_sourced', null, 'no', null),
      ('${J(5)}', 'E', 'installer_sourced', now(), 'no', null);`);
  for (const n of [1, 2, 3, 5])
    await db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, created_at) VALUES ($1, 'measurement_completed', 'x', $2::jsonb, $3)`,
      [J(n), JSON.stringify({ basis: "mitti_complete", audit_id: `audit-${n}` }), DONE_AT]);
  // a later duplicate, and a non-Mitti measurement, must not matter
  await db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, created_at) VALUES ($1, 'measurement_completed', 'x', '{"basis":"mitti_complete","audit_id":"later"}', '2026-10-30 01:00:00+00')`, [J(1)]);
  await db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details) VALUES ($1, 'measurement_completed', 'x', '{"basis":"manual"}')`, [J(4)]);
  await db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary) VALUES ($1, 'installer_price_set', 'p')`, [J(1)]);
  return db;
}
const jobs = async (db: PGlite) => (await db.query<{ job_number: string; installer_site_check: string | null; d: string | null; installer_quoted: string | null }>(
  `SELECT job_number, installer_site_check, installer_site_check_date::text AS d, installer_quoted FROM public.jobs ORDER BY job_number`)).rows;
const events = async (db: PGlite, type: string) => (await db.query<{ job_id: string; summary: string; internal: boolean; actor_id: string | null; details: Record<string, unknown> }>(
  `SELECT job_id, summary, internal, actor_id, details FROM public.workflow_events WHERE event_type = $1 ORDER BY job_id`, [type])).rows;

test("flips only live installer jobs with a finished Mitti check; Melbourne date; one event each; priced gets quote answer", async () => {
  const db = await fixture();
  await db.exec(sql);
  expect(await jobs(db)).toEqual([
    { job_number: "A", installer_site_check: "yes", d: "2026-10-28", installer_quoted: "yes" },
    { job_number: "B", installer_site_check: "yes", d: "2026-10-28", installer_quoted: null },
    { job_number: "C", installer_site_check: "no", d: null, installer_quoted: null },
    { job_number: "D", installer_site_check: "no", d: null, installer_quoted: null },
    { job_number: "E", installer_site_check: "no", d: null, installer_quoted: null },
  ]);
  const att = await events(db, "installer_attended_from_mitti");
  expect(att.map((e) => e.job_id)).toEqual([J(1), J(2)]);
  expect(att[0]).toMatchObject({ summary: "Attended: Yes — from the finished Mitti Ready Check", internal: true, actor_id: null });
  expect(att[0].details).toEqual({ audit_id: "audit-1", completed_at: "2026-10-27T22:19:56.000Z", source: "backfill" });
  const q = await events(db, "installer_quote_answer");
  expect(q).toHaveLength(1);
  expect(q[0]).toMatchObject({ job_id: J(1), summary: "Installer answered: quote prepared", internal: true });
  expect(q[0].details).toEqual({ answer: "have_quote", previous: null, source: "backfill" });
  await db.close();
});

test("a second run changes nothing and adds no events", async () => {
  const db = await fixture();
  await db.exec(sql);
  const before = [await jobs(db), (await db.query(`SELECT count(*)::int AS n FROM public.workflow_events`)).rows];
  await db.exec(sql);
  expect([await jobs(db), (await db.query(`SELECT count(*)::int AS n FROM public.workflow_events`)).rows]).toEqual(before);
  await db.close();
});
