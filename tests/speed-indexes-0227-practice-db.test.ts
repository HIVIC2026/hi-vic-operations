// Practice database proof for 0227 (decision 280): the business-scoped trade reads return the same rows before and after,
// the planner uses the new indexes, the file is re-runnable and the rollback leaves nothing behind. No network.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../docs/pending-migrations/${n}`, import.meta.url), "utf8");

const BIZ = "00000000-0000-0000-0000-00000000b001";
const USER = "00000000-0000-0000-0000-0000000000a1";
// The exact shapes trade-view.server.ts asks for, by business / by user.
const READS: Record<string, string> = {
  activeAssignments: `select job_id, business_id, role from public.job_assignments where business_id = '${BIZ}' and active = true order by job_id`,
  endedAssignments: `select job_id from public.job_assignments where business_id = '${BIZ}' and active = false order by job_id`,
  pendingOffers: `select id, job_id, kind from public.partner_offers where business_id = '${BIZ}' and status = 'pending' order by id`,
  acceptedOffers: `select job_id, kind from public.partner_offers where business_id = '${BIZ}' and status = 'accepted' order by job_id`,
  completedBookings: `select job_id, kind, scheduled_start from public.bookings where business_id = '${BIZ}' and status = 'completed' and kind in ('installation','ready_check') order by scheduled_start desc, job_id`,
  membership: `select business_id, member_role from public.business_members where user_id = '${USER}' and active = true order by business_id`,
};
const INDEXES = ["job_assignments_business_active_idx", "partner_offers_business_status_idx", "bookings_business_status_idx", "business_members_user_idx"];

test("0227 trade speed indexes keep every business-scoped read identical, are used, re-run safely and undo cleanly", async () => {
  const db = new PGlite();
  await db.exec(`
    create table public.job_assignments(id uuid primary key default gen_random_uuid(), job_id uuid not null, user_id uuid, business_id uuid, role text, active boolean not null default true);
    create table public.partner_offers(id uuid primary key default gen_random_uuid(), job_id uuid not null, business_id uuid, kind text, status text);
    create table public.bookings(id uuid primary key default gen_random_uuid(), job_id uuid not null, business_id uuid, kind text, status text, scheduled_start timestamptz);
    create table public.business_members(id uuid primary key default gen_random_uuid(), business_id uuid not null, user_id uuid not null, member_role text not null default 'member', active boolean not null default true, unique (business_id, user_id));
    -- 300 businesses, one of them ours; the existing job-led indexes are mirrored so the planner has the same choices as live.
    create index on public.job_assignments(user_id) where active;
    create unique index job_assignments_active_uq on public.job_assignments(job_id, role) where active;
    create index partner_offers_job_kind_status_idx on public.partner_offers(job_id, kind, status);
    create index on public.bookings(job_id);
    insert into public.job_assignments(job_id, user_id, business_id, role, active)
      select gen_random_uuid(), case when b = 1 then '${USER}'::uuid else gen_random_uuid() end, case when b = 1 then '${BIZ}'::uuid else gen_random_uuid() end, 'installer', g % 4 <> 0
      from generate_series(1, 300) b, generate_series(1, 12) g;
    insert into public.partner_offers(job_id, business_id, kind, status)
      select gen_random_uuid(), case when b = 1 then '${BIZ}'::uuid else gen_random_uuid() end, case when g % 2 = 0 then 'ready_check' else 'piesa' end, (array['pending','accepted','declined','withdrawn'])[1 + g % 4]
      from generate_series(1, 300) b, generate_series(1, 10) g;
    insert into public.bookings(job_id, business_id, kind, status, scheduled_start)
      select gen_random_uuid(), case when b = 1 then '${BIZ}'::uuid else gen_random_uuid() end, (array['installation','ready_check','assessment'])[1 + g % 3], case when g % 3 = 0 then 'completed' else 'confirmed' end, now() - g * interval '1 day'
      from generate_series(1, 300) b, generate_series(1, 9) g;
    insert into public.business_members(business_id, user_id, member_role, active)
      select case when b = 1 then '${BIZ}'::uuid else gen_random_uuid() end, case when b = 1 then '${USER}'::uuid else gen_random_uuid() end, 'business_admin', true
      from generate_series(1, 300) b;
    analyze;`);
  const before: Record<string, unknown[]> = {};
  for (const [k, sql] of Object.entries(READS)) before[k] = (await db.query(sql)).rows;
  expect(before["activeAssignments"]!.length).toBeGreaterThan(0);
  expect(before["pendingOffers"]!.length).toBeGreaterThan(0);
  expect(before["completedBookings"]!.length).toBeGreaterThan(0);
  expect(before["membership"]!.length).toBe(1);

  await db.exec(read("0227_trade_speed_indexes.sql"));
  await db.exec(read("0227_trade_speed_indexes.sql")); // re-runnable
  await db.exec("analyze; set enable_seqscan = off;");
  for (const [k, sql] of Object.entries(READS)) expect((await db.query(sql)).rows).toEqual(before[k]!);

  const plans = Object.fromEntries(await Promise.all(Object.entries(READS).map(async ([k, sql]) => [k, (await db.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows.map((r) => r["QUERY PLAN"]).join("\n")] as const)));
  expect(plans["activeAssignments"]).toContain("job_assignments_business_active_idx");
  expect(plans["endedAssignments"]).toContain("job_assignments_business_active_idx");
  expect(plans["pendingOffers"]).toContain("partner_offers_business_status_idx");
  expect(plans["acceptedOffers"]).toContain("partner_offers_business_status_idx");
  expect(plans["completedBookings"]).toContain("bookings_business_status_idx");
  expect(plans["membership"]).toContain("business_members_user_idx");

  await db.exec(read("0227_trade_speed_indexes.rollback.sql"));
  const left = await db.query(`select 1 from pg_indexes where indexname = any($1)`, [INDEXES]);
  expect(left.rows.length).toBe(0);
  // The reads are unchanged with the indexes gone too.
  await db.exec("set enable_seqscan = on;");
  for (const [k, sql] of Object.entries(READS)) expect((await db.query(sql)).rows).toEqual(before[k]!);
  await db.close();
});
