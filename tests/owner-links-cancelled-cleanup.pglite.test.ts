// One-off clean-up (Jo 1 Nov 2026), proven on PGlite, never live: active links on already-cancelled real jobs are
// revoked 'job_cancelled'; test jobs and open jobs are untouched; running twice changes nothing more; rollback
// restores exactly the revoked links.
import { afterAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const SQL = readFileSync("docs/pending-migrations/owner-links-cancelled-cleanup.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/owner-links-cancelled-cleanup.rollback.sql", "utf8");
const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create table public.owners(id uuid primary key, full_name text, email text);
  create table public.jobs(id uuid primary key, stage text not null, source text not null default 'base44', owner_id uuid);
  create table public.customer_estimate_links(id uuid primary key default gen_random_uuid(), job_id uuid not null, purpose text not null default 'step3_estimate',
    token text not null unique, status text not null default 'active', expires_at timestamptz not null default '2026-10-01',
    revoked_at timestamptz, revocation_reason text);
  insert into public.owners values ('00000000-0000-4000-8000-000000000001', 'Real Owner', 'real@example.com'),
    ('00000000-0000-4000-8000-000000000002', 'Jo', 'jo+test@example.com'), ('00000000-0000-4000-8000-000000000003', 'Open Owner', 'open@example.com');
  insert into public.jobs values ('00000000-0000-4000-8000-0000000000c1', 'cancelled', 'base44', '00000000-0000-4000-8000-000000000001'),
    ('00000000-0000-4000-8000-0000000000c2', 'cancelled', 'qa_test', '00000000-0000-4000-8000-000000000001'),
    ('00000000-0000-4000-8000-0000000000c3', 'cancelled', 'base44', '00000000-0000-4000-8000-000000000002'),
    ('00000000-0000-4000-8000-0000000000c4', 'preliminary_estimate_ready', 'base44', '00000000-0000-4000-8000-000000000003');
  insert into public.customer_estimate_links(job_id, token) values ('00000000-0000-4000-8000-0000000000c1', 'real-cancelled'),
    ('00000000-0000-4000-8000-0000000000c2', 'qa-cancelled'), ('00000000-0000-4000-8000-0000000000c3', 'testowner-cancelled'),
    ('00000000-0000-4000-8000-0000000000c4', 'open');
`);
afterAll(async () => { await db.close(); });
const state = async () => Object.fromEntries((await db.query<{ token: string; status: string; revocation_reason: string | null }>(
  "select token, status, revocation_reason from public.customer_estimate_links order by token")).rows.map((r) => [r.token, `${r.status}:${r.revocation_reason ?? ""}`]));

test("only the real cancelled job's link is revoked, twice is a no-op", async () => {
  await db.exec(SQL);
  const once = await state();
  expect(once).toEqual({ "real-cancelled": "revoked:job_cancelled", "qa-cancelled": "active:", "testowner-cancelled": "active:", open: "active:" });
  await db.exec(SQL);
  expect(await state()).toEqual(once);
  expect((await db.query("select * from public.owner_links_cleanup_20261101")).rows).toHaveLength(1);
});

test("rollback restores exactly the revoked link and drops the record", async () => {
  await db.exec(ROLLBACK);
  expect(await state()).toEqual({ "real-cancelled": "active:", "qa-cancelled": "active:", "testowner-cancelled": "active:", open: "active:" });
  expect((await db.query("select to_regclass('public.owner_links_cleanup_20261101') t")).rows[0]).toEqual({ t: null });
});
