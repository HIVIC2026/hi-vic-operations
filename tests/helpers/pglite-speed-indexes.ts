// Practice database check for 0145 speed indexes: apply, query uses them, undo. No network.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../../docs/pending-migrations/${n}`, import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`
  CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, event_type text not null, created_at timestamptz not null default now());
  CREATE TABLE public.evidence_requirements (id uuid primary key default gen_random_uuid(), job_id uuid, status text, required boolean);
  CREATE TABLE public.invoices (id uuid primary key default gen_random_uuid(), job_id uuid, created_at timestamptz default now());
  CREATE TABLE public.messages (id uuid primary key default gen_random_uuid(), job_id uuid);
  INSERT INTO public.workflow_events (event_type) SELECT 'e' || (g % 50) FROM generate_series(1, 20000) g;
  ANALYZE;`);
await db.exec(read("0145_speed_indexes.sql"));
await db.exec(read("0145_speed_indexes.sql")); // re-runnable
const plan = (await db.query<{ "QUERY PLAN": string }>(`EXPLAIN SELECT job_id FROM public.workflow_events WHERE event_type = 'e7' ORDER BY created_at DESC`)).rows.map((r) => r["QUERY PLAN"]).join("\n");
if (!plan.includes("workflow_events_type_created_idx")) throw new Error("index not used:\n" + plan);
await db.exec(read("0145_speed_indexes.undo.sql"));
const left = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname IN ('workflow_events_type_created_idx','evidence_requirements_open_idx','invoices_job_created_idx','messages_job_idx')`);
if (left.rows.length) throw new Error("undo left indexes");
console.log("PASS: 0145 indexes apply, are used, re-run safely and undo cleanly on practice database");
