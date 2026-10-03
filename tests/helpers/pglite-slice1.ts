// Throwaway in-process PostgreSQL (PGlite) for Slice 1. No network, no URL, no password:
// the database lives only in this test process's memory and disappears when it ends.
// Tables mirror the live columns Slice 1 touches; every row inserted is fake TEST data.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) =>
  readFileSync(new URL(`../../docs/pending-migrations/${f}`, import.meta.url), "utf8");
export const SLICE1_SQL = read("0079_slice1_ready_check_booking.sql");
export const SLICE1_ROLLBACK_SQL = read("0079_slice1_ready_check_booking.rollback.sql");

const STAGES =
  "new_enquiry,eligibility_review,awaiting_electrician,assessment_booking,assessment_booked,assessment_complete,rectification_required,awaiting_owner_rectification_approval,awaiting_deposit_payment,rectification_scheduling,rectification_booked,ready_for_installer_quotes,awaiting_quote_acceptance,installation_scheduling,installation_booked,evidence_outstanding,ap_review,ready_for_veec,complete,cancelled,on_hold,preliminary_estimate_ready,ready_check_awaiting_acceptance,ready_check_awaiting_payment,ready_check_ready_to_schedule,ready_check_scheduled,ready_check_complete,measured_estimate_ready,measured_quote_accepted,piesa_and_install_window_pending,piesa_scheduled,piesa_complete,electrical_variation_pending"
    .split(",")
    .map((s) => `'${s}'`)
    .join(",");

const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.job_stage AS ENUM (${STAGES});
CREATE TYPE public.app_role AS ENUM ('admin','electrician','installer','owner','property_manager');
CREATE TYPE public.booking_kind AS ENUM ('assessment','rectification','installation','ready_check');
CREATE TABLE public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null, unique(user_id, role));
CREATE TABLE public.owners (id uuid primary key default gen_random_uuid(), user_id uuid, full_name text, email text, phone text);
CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid(), job_number text, owner_id uuid references public.owners(id), stage public.job_stage not null default 'new_enquiry',
  prior_stage public.job_stage, next_action text, hold_reason text, cancelled_reason text, source text, last_activity_at timestamptz, updated_at timestamptz not null default now());
CREATE TABLE public.indicative_estimates (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), superseded_at timestamptz);
CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), user_id uuid not null, business_id uuid, active boolean not null default true);
CREATE TABLE public.appointment_proposals (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id), kind public.booking_kind not null,
  assignment_id uuid references public.job_assignments(id), proposed_by uuid, proposer_role text not null CHECK (proposer_role IN ('owner','electrician','installer','admin')),
  starts_at timestamptz, ends_at timestamptz, note text, status text not null default 'proposed', responded_by uuid, responded_at timestamptz, response_note text, created_at timestamptz not null default now());
CREATE TABLE public.workflow_settings (id integer primary key, piesa_install_window_days integer default 30, customer_comms_enabled boolean default false);
CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, from_stage public.job_stage, to_stage public.job_stage, internal boolean, created_at timestamptz default now());
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.has_role(auth.uid(), 'admin') $$;
CREATE FUNCTION public.is_job_owner(_job uuid, _user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.jobs j JOIN public.owners o ON o.id=j.owner_id WHERE j.id=_job AND o.user_id=_user) $$;
CREATE FUNCTION public.can_access_job(_job uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.is_admin() OR exists(SELECT 1 FROM public.job_assignments WHERE job_id=_job AND user_id=auth.uid() AND active) OR public.is_job_owner(_job, auth.uid()) $$;
`;

export const ID = {
  office: "00000000-0000-4000-8000-0000000000a1",
  ownerUser: "00000000-0000-4000-8000-0000000000b1",
  installer: "00000000-0000-4000-8000-0000000000c1",
  installer2: "00000000-0000-4000-8000-0000000000c2",
  electrician: "00000000-0000-4000-8000-0000000000d1",
  stranger: "00000000-0000-4000-8000-0000000000e1",
};

/** Seeds fake TEST rows only (made-up names, example.test emails, 0400 000 000 numbers). */
export async function slice1Db() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(`
    INSERT INTO public.workflow_settings(id) VALUES (1);
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ID.office}','admin'),('${ID.installer}','installer'),('${ID.installer2}','installer'),('${ID.electrician}','electrician'),('${ID.ownerUser}','owner');
    INSERT INTO public.owners(id, user_id, full_name, email, phone) VALUES ('10000000-0000-4000-8000-000000000001','${ID.ownerUser}','TEST Owner','test.owner@example.test','0400 000 000');
    INSERT INTO public.jobs(id, job_number, owner_id, stage, source) VALUES
      ('20000000-0000-4000-8000-000000000001','TEST-0001','10000000-0000-4000-8000-000000000001','ready_check_ready_to_schedule','qa_test'),
      ('20000000-0000-4000-8000-000000000002','TEST-0002',NULL,'ready_check_ready_to_schedule','qa_test');
    INSERT INTO public.indicative_estimates(id, job_id) VALUES ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001');
    INSERT INTO public.job_assignments(id, job_id, user_id) VALUES ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','${ID.installer}');
  `);
  const as = async (user: string | null) => {
    await db.exec(
      `RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${user ?? ""}', false);`,
    );
    if (user) await db.exec(`SET ROLE authenticated`);
  };
  const reset = () => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  return { db, as, reset };
}
