import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

// Decision 247: job-less `email_unmatched` / `email_unmatched_dismissed` events only; every other event keeps its
// job, workflow_events stays append-only, and the migration is idempotent. Fixture mirrors drizzle 0000.
const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE public.job_stage AS ENUM ('new_enquiry','cancelled');
    CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid());
    CREATE TABLE public.workflow_events (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references public.jobs(id) on delete cascade,
      actor_id uuid, event_type text not null, from_stage public.job_stage, to_stage public.job_stage,
      summary text not null, details jsonb not null default '{}'::jsonb, internal boolean not null default false,
      created_at timestamptz not null default now());
    CREATE FUNCTION public.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events is append-only'; END $$;
    CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON public.workflow_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();
    INSERT INTO public.jobs (id) VALUES ('11111111-1111-4111-8111-111111111111');`);
  return db;
}
const ins = (db: PGlite, job: string | null, type: string) =>
  db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, internal) VALUES ($1, $2, 's', '{"message_id":"m1"}', true)`, [job, type]);

test("before the migration a job-less event is refused (the copier then counts it as not recorded)", async () => {
  const db = await fixture();
  await expect(ins(db, null, "email_unmatched")).rejects.toThrow(/null/i);
  await db.close();
});

test("after: only the two email types may have no job; append-only and job events unchanged; idempotent", async () => {
  const db = await fixture();
  await db.exec(read("email-unmatched-events.sql"));
  await db.exec(read("email-unmatched-events.sql"));
  await ins(db, null, "email_unmatched");
  await ins(db, null, "email_unmatched_dismissed");
  await ins(db, "11111111-1111-4111-8111-111111111111", "email_unmatched_matched");
  await ins(db, "11111111-1111-4111-8111-111111111111", "email_change_request");
  await expect(ins(db, null, "email_change_request")).rejects.toThrow(/workflow_events_job_required/);
  await expect(ins(db, null, "stage_changed")).rejects.toThrow(/workflow_events_job_required/);
  await expect(db.exec(`UPDATE public.workflow_events SET summary = 'x'`)).rejects.toThrow(/append-only/);
  const n = await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.workflow_events WHERE details @> '{"message_id":"m1"}'`);
  expect(n.rows[0]!.n).toBe(4);
  // Rollback refuses while job-less events exist (they can't be deleted from an append-only log).
  await expect(db.exec(read("email-unmatched-events.rollback.sql"))).rejects.toThrow(/keep email-unmatched-events/);
  await db.close();
});

test("rollback before use restores NOT NULL", async () => {
  const db = await fixture();
  await db.exec(read("email-unmatched-events.sql"));
  await db.exec(read("email-unmatched-events.rollback.sql"));
  await expect(ins(db, null, "email_unmatched")).rejects.toThrow(/null/i);
  await db.close();
});
