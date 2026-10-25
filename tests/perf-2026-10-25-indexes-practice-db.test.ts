// docs/pending-migrations/perf-2026-10-25-indexes.sql proven on a practice Postgres (PGlite), never live: it applies
// twice, each index serves the query shape it was added for (seq scans disabled so the planner must use an index if one
// fits), the PIESA-deadline view's lateral lookup uses the new index, and the rollback removes exactly these indexes.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const MIGRATION = readFileSync("docs/pending-migrations/perf-2026-10-25-indexes.sql", "utf8");
const ROLLBACK = readFileSync("docs/pending-migrations/perf-2026-10-25-indexes.rollback.sql", "utf8");
const VIEW = readFileSync("docs/pending-migrations/piesa-deadline-from-official-piesa.sql", "utf8");
const NAMES = [
  "piesa_records_job_kind_created_perf1025_idx", "bulk_import_rows_job_perf1025_idx", "customer_email_sends_job_created_perf1025_idx",
  "workflow_events_job_type_created_perf1025_idx", "property_facts_property_key_current_perf1025_idx", "external_sync_logs_errors_perf1025_idx",
];
const db = new PGlite();
await db.exec(`
  create type job_stage as enum ('installation_scheduling','complete','cancelled');
  create table jobs(id uuid primary key default gen_random_uuid(), stage job_stage not null default 'installation_scheduling', installation_completed_at timestamptz);
  create table workflow_settings(id int primary key, piesa_install_window_days int not null default 30, urgency_red_days int not null default 7, urgency_amber_days int not null default 14);
  insert into workflow_settings(id) values (1);
  create table piesa_records(id uuid primary key default gen_random_uuid(), job_id uuid, kind text, outcome text, completed_date date, is_current boolean, created_at timestamptz default now());
  create unique index piesa_current_uq on piesa_records(job_id) where is_current;
  create table bulk_import_rows(id uuid primary key default gen_random_uuid(), batch_id uuid, job_id uuid);
  create table customer_email_sends(id uuid primary key default gen_random_uuid(), job_id uuid, purpose text, status text, created_at timestamptz default now());
  create table workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid, event_type text not null, created_at timestamptz not null default now(), details jsonb);
  create index workflow_events_job_id_created_at_idx on workflow_events(job_id, created_at desc);
  create table property_facts(id uuid primary key default gen_random_uuid(), job_id uuid, property_id uuid, fact_key text, value jsonb, is_current boolean default true);
  create table external_sync_logs(id uuid primary key default gen_random_uuid(), entity_id uuid, system text, status text, error text, created_at timestamptz default now());
  insert into jobs(id) select gen_random_uuid() from generate_series(1, 2000);
  insert into piesa_records(job_id, kind, outcome, completed_date, is_current, created_at)
    select id, 'initial', 'pass', date '2026-10-01', true, now() - interval '3 days' from jobs;
  insert into bulk_import_rows(batch_id, job_id) select gen_random_uuid(), id from jobs;
  insert into customer_email_sends(job_id, purpose, status) select id, 'estimate', 'sent' from jobs, generate_series(1, 5);
  insert into workflow_events(job_id, event_type) select id, 'e' || g from jobs, generate_series(1, 20) g;
  insert into property_facts(job_id, property_id, fact_key) select id, id, 'k' || g from jobs, generate_series(1, 5) g;
  insert into external_sync_logs(entity_id, system, status) select id, 'mitti', case when random() < 0.02 then 'error' else 'ok' end from jobs, generate_series(1, 10);
`);
await db.exec(VIEW);
const plan = async (sql: string) => (await db.query<{ "QUERY PLAN": string }>(`explain ${sql}`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
const indexes = async () => (await db.query<{ indexname: string }>(`select indexname from pg_indexes where indexname like '%perf1025%' order by 1`)).rows.map((r) => r.indexname);

describe("perf-2026-10-25 indexes on PGlite", () => {
  test("applies twice and creates exactly the six indexes", async () => {
    await db.exec(MIGRATION); await db.exec(MIGRATION);
    await db.exec("analyze");
    expect(await indexes()).toEqual([...NAMES].sort());
  });
  test("each index serves the query it is for", async () => {
    await db.exec("set enable_seqscan = off");
    const j = (await db.query<{ id: string }>("select id from jobs limit 1")).rows[0]!.id;
    expect(await plan(`select completed_date from piesa_records r where r.job_id = '${j}' and r.kind in ('initial','reassessment') order by r.created_at desc limit 1`)).toContain("piesa_records_job_kind_created_perf1025_idx");
    expect(await plan(`select id from bulk_import_rows where job_id = '${j}'`)).toContain("bulk_import_rows_job_perf1025_idx");
    expect(await plan(`select status from customer_email_sends s where s.job_id = '${j}' order by s.created_at desc limit 1`)).toContain("customer_email_sends_job_created_perf1025_idx");
    expect(await plan(`select id from workflow_events where job_id = '${j}' and event_type = 'e3'`)).toContain("workflow_events_job_type_created_perf1025_idx");
    expect(await plan(`select value from property_facts where property_id = '${j}' and fact_key = 'k1' and is_current limit 1`)).toContain("property_facts_property_key_current_perf1025_idx");
    expect(await plan(`select entity_id from external_sync_logs where status = 'error' and created_at >= now() - interval '3 days'`)).toContain("external_sync_logs_errors_perf1025_idx");
    // The deadline view's lateral "latest official PIESA" now uses the index for the jobs asked for.
    expect(await plan(`select install_deadline from job_piesa_deadlines where job_id = '${j}'`)).toContain("piesa_records_job_kind_created_perf1025_idx");
    await db.exec("reset enable_seqscan");
  });
  test("the view's results are unchanged by the indexes", async () => {
    const r = await db.query<{ n: number; d: string }>("select count(*)::int as n, min(install_deadline)::text as d from job_piesa_deadlines");
    expect(r.rows[0]).toEqual({ n: 2000, d: "2026-10-31" });
  });
  test("rollback removes exactly these indexes and is idempotent", async () => {
    await db.exec(ROLLBACK); await db.exec(ROLLBACK);
    expect(await indexes()).toEqual([]);
    expect((await db.query("select 1 from pg_indexes where indexname in ('piesa_current_uq','workflow_events_job_id_created_at_idx')")).rows.length).toBe(2);
  });
});
