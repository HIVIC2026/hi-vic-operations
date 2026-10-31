import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Staged one-off for ONLY HV-3117, HV-3197, HV-3385, HV-3497, HV-3666: finished Mitti check → Attended = Yes,
// priced → "quote prepared". Proven on PGlite with minimal copies of jobs + workflow_events.
const sql = readFileSync(new URL("../docs/pending-migrations/mitti-ready-check-attended-backfill.sql", import.meta.url), "utf8");
const preview = sql.slice(sql.indexOf("-- PREVIEW BEGIN"), sql.indexOf("-- PREVIEW END")).split("\n").slice(1).map((l) => l.replace(/^-- ?/, "")).join("\n");
const J = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
const DONE_AT = "2026-10-27 22:19:56+00"; // Melbourne: 28 Oct 2026

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.jobs (id uuid primary key, job_number text, stage text default 'measured_estimate_ready', channel text, deleted_at timestamptz,
      installer_site_check text, installer_site_check_date date, installer_quoted text);
    CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id),
      actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb,
      internal boolean not null default false, created_at timestamptz not null default now());
    INSERT INTO public.jobs (id, job_number, channel, deleted_at, installer_site_check, installer_quoted) VALUES
      ('${J(1)}', 'HV-3117', 'installer_sourced', null, 'no', 'no'),
      ('${J(2)}', 'HV-3197', 'installer_sourced', null, null, null),
      ('${J(3)}', 'HV-3385', 'installer_sourced', null, 'no', null),
      ('${J(4)}', 'HV-3497', 'installer_sourced', null, 'no', null),
      ('${J(5)}', 'HV-3666', 'hivic_sourced', null, 'no', null),
      ('${J(6)}', 'HV-9001', 'installer_sourced', null, 'no', 'no');`);
  const ev = (n: number, type: string, details: unknown, at: string) => db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, created_at) VALUES ($1, $2, 'x', $3::jsonb, $4)`, [J(n), type, JSON.stringify(details), at]);
  for (const n of [1, 2, 4, 5, 6]) await ev(n, "measurement_completed", { basis: "mitti_complete", audit_id: `audit-${n}` }, DONE_AT);
  // a later duplicate finish, and a non-Mitti measurement (HV-3385 has no finished-Mitti marker), must not matter
  await ev(1, "measurement_completed", { basis: "mitti_complete", audit_id: "later" }, "2026-10-30 01:00:00+00");
  await ev(3, "measurement_completed", { basis: "manual" }, DONE_AT);
  // HV-3117: answered "not quoted" BEFORE the price → becomes quote prepared, previous = not_quoted
  await ev(1, "installer_quote_answer", { answer: "not_quoted" }, "2026-10-29 00:00:00+00");
  await ev(1, "installer_price_set", {}, "2026-10-29 01:00:00+00");
  // HV-3197: priced, then the installer's own later "not quoted" answer → stays
  await ev(2, "installer_price_set", {}, "2026-10-29 01:00:00+00");
  await ev(2, "installer_quote_answer", { answer: "not_quoted" }, "2026-10-29 02:00:00+00");
  // HV-3385: priced but no finished Mitti check → untouched
  await ev(3, "installer_price_set", {}, "2026-10-29 01:00:00+00");
  // HV-3497: installer answered "not attended" by hand AFTER the finish → attended stays no; priced, no answer → prepared
  await ev(4, "installer_attendance_answer", { answer: "not_attended" }, "2026-10-29 00:00:00+00");
  await ev(4, "installer_price_set", {}, "2026-10-29 01:00:00+00");
  // HV-3666 (our lead) and HV-9001 (not in the list): finished and priced → untouched
  await ev(5, "installer_price_set", {}, "2026-10-29 01:00:00+00");
  await ev(6, "installer_price_set", {}, "2026-10-29 01:00:00+00");
  return db;
}
const jobs = async (db: PGlite) => (await db.query<{ job_number: string; installer_site_check: string | null; d: string | null; installer_quoted: string | null }>(
  `SELECT job_number, installer_site_check, installer_site_check_date::text AS d, installer_quoted FROM public.jobs ORDER BY job_number`)).rows;
const events = async (db: PGlite, type: string, source = "backfill") => (await db.query<{ job_id: string; summary: string; internal: boolean; actor_id: string | null; details: Record<string, unknown> }>(
  `SELECT job_id, summary, internal, actor_id, details FROM public.workflow_events WHERE event_type = $1 AND details->>'source' = $2 ORDER BY job_id`, [type, source])).rows;

test("only the 5 listed jobs; later hand answers win; Melbourne date; one event each", async () => {
  const db = await fixture();
  await db.exec(sql);
  expect(await jobs(db)).toEqual([
    { job_number: "HV-3117", installer_site_check: "yes", d: "2026-10-28", installer_quoted: "yes" },
    { job_number: "HV-3197", installer_site_check: "yes", d: "2026-10-28", installer_quoted: null },
    { job_number: "HV-3385", installer_site_check: "no", d: null, installer_quoted: null },
    { job_number: "HV-3497", installer_site_check: "no", d: null, installer_quoted: "yes" },
    { job_number: "HV-3666", installer_site_check: "no", d: null, installer_quoted: null },
    { job_number: "HV-9001", installer_site_check: "no", d: null, installer_quoted: "no" },
  ]);
  const att = await events(db, "installer_attended_from_mitti");
  expect(att.map((e) => e.job_id)).toEqual([J(1), J(2)]);
  expect(att[0]).toMatchObject({ summary: "Attended: Yes — from the finished Mitti Ready Check", internal: true, actor_id: null });
  expect(att[0].details).toEqual({ audit_id: "audit-1", completed_at: "2026-10-27T22:19:56.000Z", source: "backfill" });
  const q = await events(db, "installer_quote_answer");
  expect(q.map((e) => e.job_id)).toEqual([J(1), J(4)]);
  expect(q[0]).toMatchObject({ summary: "Installer answered: quote prepared", internal: true });
  expect(q[0].details).toEqual({ answer: "have_quote", previous: "not_quoted", source: "backfill" });
  expect(q[1].details).toEqual({ answer: "have_quote", previous: null, source: "backfill" });
  await db.close();
});

test("the read-only preview lists the 5 jobs and exactly what each step would change, and changes nothing", async () => {
  const db = await fixture();
  const before = await jobs(db);
  const rows = (await db.query<Record<string, unknown>>(preview)).rows;
  expect(await jobs(db)).toEqual(before);
  expect(rows.map((r) => [r["job_number"], r["stage"], r["step1_sets_attended_yes"], r["step2_sets_quote_prepared"]])).toEqual([
    ["HV-3117", "measured_estimate_ready", true, true],
    ["HV-3197", "measured_estimate_ready", true, false],
    ["HV-3385", "measured_estimate_ready", false, false],
    ["HV-3497", "measured_estimate_ready", false, true],
    ["HV-3666", "measured_estimate_ready", false, false],
  ]);
  await db.close();
});

test("a deleted listed job is untouched", async () => {
  const db = await fixture();
  await db.query(`UPDATE public.jobs SET deleted_at = now() WHERE job_number = 'HV-3117'`);
  await db.exec(sql);
  expect((await jobs(db))[0]).toEqual({ job_number: "HV-3117", installer_site_check: "no", d: null, installer_quoted: "no" });
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
