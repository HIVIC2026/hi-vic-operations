// Practice database (PGlite) for 0087: acceptance re-checks and visit-scoped contact visibility. Fake TEST rows only.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const U = { rec: "00000000-0000-4000-8000-000000000001", inst: "00000000-0000-4000-8000-000000000003", owner: "00000000-0000-4000-8000-000000000004" };
const B = "10000000-0000-4000-8000-000000000001", JOB = "20000000-0000-4000-8000-000000000001", OWNER = "30000000-0000-4000-8000-000000000001", PROP = "40000000-0000-4000-8000-000000000001";

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
CREATE TABLE public.job_assignments (id uuid primary key default gen_random_uuid(), job_id uuid not null references jobs(id), user_id uuid not null references profiles(id), role assignment_role not null, business_id uuid, active boolean not null default true, assigned_by uuid references profiles(id), assigned_at timestamptz not null default now());
CREATE TABLE public.partner_offers (id uuid primary key default gen_random_uuid(), job_id uuid not null, business_id uuid not null, status text not null default 'pending', summary jsonb not null default '{}', offered_by uuid, offered_at timestamptz not null default now(), expires_at timestamptz, responded_by uuid, responded_at timestamptz, decline_reason text);
CREATE TABLE public.workflow_settings (id integer primary key default 1);
CREATE TABLE public.piesa_records (id uuid primary key default gen_random_uuid(), job_id uuid);
CREATE TABLE public.quotes (id uuid primary key default gen_random_uuid(), job_id uuid, kind text, status text);
CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text, summary text, details jsonb, internal boolean);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.can_access_job(_job uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_or_assignee ON public.owners FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.owners, public.jobs, public.job_assignments TO authenticated;
INSERT INTO workflow_settings DEFAULT VALUES;
INSERT INTO profiles VALUES ('${U.rec}'),('${U.inst}'),('${U.owner}');
INSERT INTO businesses VALUES ('${B}','TEST REC',true,'approved','A1',null,now(),ARRAY['3199']);
INSERT INTO business_members (business_id,user_id) VALUES ('${B}','${U.rec}');
INSERT INTO partner_workers (business_id,trade_role,approval_status) VALUES ('${B}','electrician','approved');
INSERT INTO owners VALUES ('${OWNER}','${U.owner}','TEST Owner');
INSERT INTO properties VALUES ('${PROP}','3199');
INSERT INTO jobs VALUES ('${JOB}','${OWNER}','${PROP}','piesa_and_install_window_pending');
`;
let db: PGlite;
const offer = async () => (await db.query<{ id: string }>(`INSERT INTO partner_offers (job_id,business_id,kind,expires_at) VALUES ('${JOB}','${B}','piesa',now()+interval '2 hours') RETURNING id`)).rows[0]!.id;
const accept = async () => (await db.query<{ outcome: string }>(`SELECT * FROM accept_partner_offer('${await offer()}','${U.rec}')`)).rows[0]!.outcome;
const sees = async (user: string) => {
  await db.exec(`SET ROLE authenticated; SELECT set_config('request.jwt.claim.sub','${user}',false);`);
  try { return (await db.query<{ ok: boolean }>(`SELECT has_contact_release('${JOB}','${user}') ok`)).rows[0]!.ok; } finally { await db.exec("RESET ROLE;"); }
};
beforeEach(async () => { db = new PGlite(); await db.exec(BASE); await db.exec(read("0086_piesa_allocation_self_scheduling.sql")); await db.exec(read("0087_allocation_hardening.sql")); });

describe("0087 acceptance re-checks (practice database)", () => {
  test("qualified, in-area REC at the PIESA stage is accepted", async () => { expect(await accept()).toBe("accepted"); });
  test("job no longer at the PIESA gate is refused", async () => {
    await db.exec(`UPDATE jobs SET stage='measured_quote_accepted'`); expect(await accept()).toBe("job_not_ready");
  });
  test("out-of-area or unverified coverage is refused; wildcard prefix works", async () => {
    await db.exec(`UPDATE businesses SET service_postcodes=ARRAY['3000']`); expect(await accept()).toBe("out_of_area");
    await db.exec(`UPDATE businesses SET service_postcodes=ARRAY['31*']`); expect(await accept()).toBe("accepted");
  });
  test("unverified coverage refused", async () => { await db.exec(`UPDATE businesses SET coverage_verified_at=null`); expect(await accept()).toBe("out_of_area"); });
  test("no licence or no approved electrician worker is refused", async () => {
    await db.exec(`UPDATE partner_workers SET approval_status='pending'`); expect(await accept()).toBe("not_qualified");
    await db.exec(`UPDATE partner_workers SET approval_status='approved'; UPDATE businesses SET licence_number=null`); expect(await accept()).toBe("not_qualified");
  });
});

describe("0087 contacts only for the current visit", () => {
  test("Ready Check installer loses owner contacts once the job moves to PIESA; electrician gains them", async () => {
    await db.exec(`UPDATE jobs SET stage='ready_check_scheduled'`);
    await db.exec(`INSERT INTO job_assignments (job_id,user_id,role,active) VALUES ('${JOB}','${U.inst}','installer',true)`);
    expect(await sees(U.inst)).toBe(true);
    await db.exec(`UPDATE jobs SET stage='piesa_and_install_window_pending'`);
    expect(await sees(U.inst)).toBe(false);
    expect(await accept()).toBe("accepted");
    expect(await sees(U.rec)).toBe(true);
    await db.exec(`UPDATE jobs SET stage='installation_scheduling'`);
    expect(await sees(U.rec)).toBe(false);
    expect(await sees(U.inst)).toBe(false); // installation contacts need their own release after clearance
    await db.exec(`INSERT INTO contact_releases (job_id,assignment_id,visit_kind,owner_notice,trade_notice) SELECT job_id,id,'installation','o','t' FROM job_assignments WHERE role='installer'`);
    expect(await sees(U.inst)).toBe(true);
  });
});
