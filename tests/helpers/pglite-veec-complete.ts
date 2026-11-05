// Throwaway in-process PostgreSQL (PGlite) for complete_veec_assignment. Fake TEST data only.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../../docs/pending-migrations/${f}`, import.meta.url), "utf8");
export const VEEC_COMPLETE_SQL = read("complete-veec-assignment.sql");
export const VEEC_COMPLETE_ROLLBACK_SQL = read("complete-veec-assignment.rollback.sql");

export const VC = {
  job: "10000000-0000-4000-8000-0000000000e1",
  assignment: "20000000-0000-4000-8000-0000000000e1",
  actor: "30000000-0000-4000-8000-0000000000e1",
};

const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.assignment_status AS ENUM ('draft','consumer_signed_pending_install','final_details_pending','installer_signed_pending_install','variation_required','awaiting_installer_signature','awaiting_ap_signature','awaiting_consumer_signature','effective_complete','cancelled');
CREATE TYPE public.pass_fail AS ENUM ('pending','pass','fail');
CREATE TABLE public.profiles (id uuid primary key);
CREATE TABLE public.jobs (id uuid primary key, job_number text, last_activity_at timestamptz);
CREATE TABLE public.customer_assignments (
  id uuid primary key, job_id uuid not null references public.jobs(id), status public.assignment_status not null default 'draft',
  effective_at timestamptz, completed_at timestamptz, final_copy_path text, final_copy_at timestamptz,
  delivery_status text not null default 'not_ready' check (delivery_status in ('not_ready','pending_comms_lock','ready_to_send','delivered')));
CREATE TABLE public.compliance_checks (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), check_key text not null,
  status public.pass_fail not null default 'pending', checked_at timestamptz, notes text, unique (job_id, check_key));
CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), actor_id uuid references public.profiles(id),
  event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
`;

export async function veecCompleteDb(applySql = true) {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(`INSERT INTO public.profiles VALUES ('${VC.actor}'); INSERT INTO public.jobs VALUES ('${VC.job}', 'TEST-0001');
    INSERT INTO public.customer_assignments (id, job_id, status) VALUES ('${VC.assignment}', '${VC.job}', 'awaiting_consumer_signature');
    INSERT INTO public.compliance_checks (job_id, check_key) VALUES ('${VC.job}', 'owner_authority');`);
  if (applySql) await db.exec(VEEC_COMPLETE_SQL);
  return db;
}

export const callComplete = (db: PGlite, over: Partial<Record<"assignment" | "job" | "actor", string>> = {}) =>
  db.query<{ ok: boolean }>(
    `SELECT public.complete_veec_assignment($1::uuid,$2::uuid,$3,$4::timestamptz,$5,$6,$7::uuid,$8) AS ok`,
    [over.assignment ?? VC.assignment, over.job ?? VC.job, "j/assignment/final-abc.pdf", "2026-11-05T01:00:00Z", "ready_to_send", "sha-1", over.actor ?? VC.actor, "Final VEEC assignment effective – signed copy stored (customer delivery ready)"],
  );
