// Practice database (PGlite) for 0150: a PIESA offer is only "already taken" by a CONFIRMED visit (P1 UAT DEF-07).
// Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const U = { rec: "00000000-0000-4000-8000-000000000001", rec2: "00000000-0000-4000-8000-000000000002", owner: "00000000-0000-4000-8000-000000000004" };
const B = "10000000-0000-4000-8000-000000000001", B2 = "10000000-0000-4000-8000-000000000002", JOB = "20000000-0000-4000-8000-000000000001", OWNER = "30000000-0000-4000-8000-000000000001", PROP = "40000000-0000-4000-8000-000000000001";

const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TYPE assignment_role AS ENUM ('electrician','installer','property_manager');
CREATE TYPE job_stage AS ENUM ('ready_check_scheduled','measured_quote_accepted','piesa_and_install_window_pending','piesa_scheduled','rectification_scheduling','installation_scheduling','complete');
CREATE TABLE public.profiles (id uuid primary key);
CREATE TABLE public.businesses (id uuid primary key, name text not null, is_active boolean not null default true, onboarding_status text not null default 'draft',
  licence_number text, rec_number text, coverage_verified_at timestamptz, service_postcodes text[]);
CREATE TABLE public.business_members (id uuid primary key default gen_random_uuid(), business_id uuid not null, user_id uuid not null);
CREATE TABLE public.partner_workers (id uuid primary key default gen_random_uuid(), business_id uuid, trade_role assignment_role, approval_status text, removed_at timestamptz);
CREATE TABLE public.owners (id uuid primary key, user_id uuid, full_name text);
CREATE TABLE public.properties (id uuid primary key, postcode text);
CREATE TABLE public.jobs (id uuid primary key, owner_id uuid, property_id uuid, stage job_stage not null);
CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id), user_id uuid not null references profiles(id), role assignment_role not null, business_id uuid, active boolean not null default true, assigned_by uuid references profiles(id), assigned_at timestamptz not null default now(), booking_confirmed_at timestamptz);
CREATE TABLE public.partner_offers (id uuid primary key default gen_random_uuid(), job_id uuid not null, business_id uuid not null, kind text not null default 'piesa', status text not null default 'pending', summary jsonb not null default '{}', offered_by uuid, offered_at timestamptz not null default now(), expires_at timestamptz, responded_by uuid, responded_at timestamptz, decline_reason text, superseded_at timestamptz);
CREATE TABLE public.workflow_settings (id integer primary key default 1);
CREATE TABLE public.piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text);
-- contact_releases is created by 0086 (applied in beforeEach), so it is not defined here.
CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.can_access_job(_job uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_or_assignee ON public.owners FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.owners, public.jobs, public.job_assignments TO authenticated;
INSERT INTO workflow_settings DEFAULT VALUES;
INSERT INTO profiles VALUES ('${U.rec}'),('${U.rec2}'),('${U.owner}');
INSERT INTO businesses VALUES ('${B}','TEST REC',true,'approved','A1',null,now(),ARRAY['3199']);
INSERT INTO businesses VALUES ('${B2}','TEST REC TWO',true,'approved','A2',null,now(),ARRAY['3199']);
INSERT INTO business_members (business_id,user_id) VALUES ('${B}','${U.rec}'),('${B2}','${U.rec2}');
INSERT INTO partner_workers (business_id,trade_role,approval_status) VALUES ('${B}','electrician','approved'),('${B2}','electrician','approved');
INSERT INTO owners VALUES ('${OWNER}','${U.owner}','TEST Owner');
INSERT INTO properties VALUES ('${PROP}','3199');
INSERT INTO jobs VALUES ('${JOB}','${OWNER}','${PROP}','piesa_and_install_window_pending');
`;

let db: PGlite;
const offer = async (business = B) => (await db.exec(`UPDATE partner_offers SET status='withdrawn' WHERE status='pending'`),
  await db.query<{ id: string }>(`INSERT INTO partner_offers (job_id,business_id,kind,expires_at) VALUES ('${JOB}','${business}','piesa',now()+interval '2 hours') RETURNING id`)).rows[0]!.id;
const accept = async (user = U.rec, business = B) => (await db.query<{ outcome: string }>(`SELECT * FROM accept_partner_offer('${await offer(business)}','${user}')`)).rows[0]!.outcome;
const stage = async () => (await db.query<{ stage: string }>(`SELECT stage::text stage FROM jobs WHERE id='${JOB}'`)).rows[0]!.stage;
const preassign = async (confirmed: boolean) => db.exec(`INSERT INTO job_assignments (job_id,user_id,role,business_id,active,booking_confirmed_at)
  VALUES ('${JOB}','${U.rec2}','electrician','${B2}',true,${confirmed ? "now()" : "null"})`);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(BASE);
  await db.exec(read("0086_piesa_allocation_self_scheduling.sql"));
  await db.exec(read("0087_allocation_hardening.sql"));
  await db.exec(read("0088_offer_batch_index.sql"));
  await db.exec(read("0150_piesa_accept_confirmed_only.sql"));
});

describe("0150 a pre-assigned electrician who never booked a visit does not block PIESA acceptance", () => {
  test("a pre-assignment without a confirmed visit does not take the job", async () => {
    await preassign(false);
    expect(await accept()).toBe("accepted");
    const rows = (await db.query<{ user_id: string; active: boolean; booking_confirmed_at: string | null }>(
      `SELECT user_id, active, booking_confirmed_at FROM job_assignments WHERE job_id='${JOB}' ORDER BY assigned_at`)).rows;
    expect(rows.length).toBe(2);
    expect(rows[1]!.user_id).toBe(U.rec); // the accepting electrician got the job
    expect(rows[1]!.booking_confirmed_at).toBeNull(); // ...and still has to book the visit
    expect(await stage()).toBe("piesa_and_install_window_pending"); // acceptance never moves the stage
  });

  test("the offer is NOT withdrawn when a pre-assignment exists", async () => {
    await preassign(false);
    const id = await offer();
    expect((await db.query<{ outcome: string }>(`SELECT * FROM accept_partner_offer('${id}','${U.rec}')`)).rows[0]!.outcome).toBe("accepted");
    expect((await db.query<{ status: string }>(`SELECT status FROM partner_offers WHERE id='${id}'`)).rows[0]!.status).toBe("accepted");
  });

  test("a CONFIRMED visit still takes the job and withdraws the offer", async () => {
    await preassign(true);
    const id = await offer();
    expect((await db.query<{ outcome: string }>(`SELECT * FROM accept_partner_offer('${id}','${U.rec}')`)).rows[0]!.outcome).toBe("already_assigned");
    expect((await db.query<{ status: string }>(`SELECT status FROM partner_offers WHERE id='${id}'`)).rows[0]!.status).toBe("withdrawn");
  });

  test("an inactive confirmed assignment does not block acceptance", async () => {
    await db.exec(`INSERT INTO job_assignments (job_id,user_id,role,business_id,active,booking_confirmed_at)
      VALUES ('${JOB}','${U.rec2}','electrician','${B2}',false,now())`);
    expect(await accept()).toBe("accepted");
  });

  test("the pre-0150 rule would have refused the same offer (rollback restores the defect)", async () => {
    await preassign(false);
    await db.exec(read("0150_piesa_accept_confirmed_only.rollback.sql"));
    expect(await accept()).toBe("already_assigned");
  });
});
