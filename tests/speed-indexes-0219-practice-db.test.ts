// Practice database proof for 0219: same per-job media/removed results before and after, indexes used, undo clean.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../docs/pending-migrations/${n}`, import.meta.url), "utf8");

const PER_JOB = `select j.id,
  (select count(*) from (select d.storage_path from public.documents d where d.job_id=j.id and d.kind='intake_media'
     union select e.storage_path from public.evidence_files e where e.job_id=j.id and e.storage_path like j.id::text||'/intake/%') m) media_count,
  greatest((select max(d.created_at) from public.documents d where d.job_id=j.id and d.kind='intake_media'),
           (select max(e.uploaded_at) from public.evidence_files e where e.job_id=j.id and e.storage_path like j.id::text||'/intake/%')) latest,
  exists(select 1 from public.workflow_events w where w.job_id=j.id and w.event_type='lead_removed') removed
  from public.jobs j order by j.id`;

test("0219 indexes keep every job's media count, latest media and removed flag identical", async () => {
  const db = new PGlite();
  await db.exec(`
    create table public.jobs(id uuid primary key default gen_random_uuid());
    create table public.documents(id uuid primary key default gen_random_uuid(), job_id uuid, kind text, storage_path text, created_at timestamptz default now());
    create table public.evidence_files(id uuid primary key default gen_random_uuid(), job_id uuid, storage_path text, uploaded_at timestamptz default now());
    create table public.workflow_events(id uuid primary key default gen_random_uuid(), job_id uuid, event_type text, created_at timestamptz default now());
    insert into public.jobs select gen_random_uuid() from generate_series(1,400);
    insert into public.documents(job_id,kind,storage_path,created_at)
      select id, case when g%3=0 then 'intake_media' else 'quote' end, id::text||'/intake/'||g, now()-g*interval '1 hour'
      from public.jobs, generate_series(1,6) g;
    insert into public.evidence_files(job_id,storage_path,uploaded_at)
      select id, case when g%2=0 then id::text||'/intake/'||g else id::text||'/other/'||g end, now()-g*interval '1 minute' from public.jobs, generate_series(1,3) g;
    insert into public.workflow_events(job_id,event_type) select id, case when random()<0.1 then 'lead_removed' else 'note' end from public.jobs, generate_series(1,20);
    analyze;`);
  const before = (await db.query(PER_JOB)).rows;
  await db.exec(read("0219_speed_indexes.sql"));
  await db.exec(read("0219_speed_indexes.sql")); // re-runnable
  await db.exec("analyze; set enable_seqscan=off;");
  const after = (await db.query(PER_JOB)).rows;
  expect(after).toEqual(before);
  const plan = (await db.query<{ "QUERY PLAN": string }>(`explain ${PER_JOB}`)).rows.map(r => r["QUERY PLAN"]).join("\n");
  expect(plan).toContain("documents_job_id_kind_idx");
  expect(plan).toContain("evidence_files_job_id_idx");
  await db.exec(read("0219_speed_indexes.rollback.sql"));
  const left = await db.query(`select 1 from pg_indexes where indexname in ('documents_job_id_kind_idx','evidence_files_job_id_idx','workflow_events_lead_removed_idx')`);
  expect(left.rows.length).toBe(0);
  await db.close();
});
