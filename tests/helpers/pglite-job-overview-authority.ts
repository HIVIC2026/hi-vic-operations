import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
function functionSql(source: string, name: string): string {
  const start = source.search(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
  if (start < 0) throw new Error(`Missing function ${name}`);
  const delimiter = /\$[A-Za-z_]*\$/g;
  delimiter.lastIndex = start;
  const open = delimiter.exec(source);
  if (!open) throw new Error(`Missing body for ${name}`);
  const close = source.indexOf(open[0], open.index + open[0].length);
  return source.slice(start, source.indexOf(";", close) + 1);
}
const authorityMigration = read("drizzle/migrations/0002_owner_authority_and_payment_hardening.sql");
const core = read("drizzle/migrations/0000_hivic_core_schema.sql");
const applied = read("docs/pending-migrations/separate-invoices.sql");
const start = applied.indexOf("CREATE OR REPLACE VIEW public.job_overview");
if (start < 0) throw new Error("Missing applied job_overview definition");
export const currentOverviewSql = applied.slice(start).trim();

/** Candidate for practice comparison only; no policy, function, owner or grants changed. */
export const inlineOverviewSql = currentOverviewSql
  .replace("job_authority_status(j.id) AS authority_status", `CASE WHEN (SELECT public.is_admin()) OR public.can_access_job(j.id) THEN
      CASE WHEN a.id IS NULL THEN 'not_requested'
        WHEN a.status = 'accepted' AND a.expires_at < now() THEN 'expired'
        ELSE a.status::text END
      ELSE NULL::text END AS authority_status`)
  .replace("job_authority_expires_at(j.id) AS authority_expires_at", "CASE WHEN (SELECT public.is_admin()) OR public.can_access_job(j.id) THEN a.expires_at ELSE NULL::timestamptz END AS authority_expires_at")
  .replace("FROM jobs j", "FROM jobs j LEFT JOIN LATERAL (SELECT * FROM public.owner_authorities oa WHERE oa.job_id = j.id ORDER BY version DESC LIMIT 1) a ON true");

export const CALLERS = {
  admin: "00000000-0000-4000-8000-000000000001",
  installer: "00000000-0000-4000-8000-000000000002",
  electrician: "00000000-0000-4000-8000-000000000003",
  owner: "00000000-0000-4000-8000-000000000004",
  unrelated: "00000000-0000-4000-8000-000000000005",
};
export type AuthorityRow = { job_number: string; authority_status: string | null; authority_expires_at: Date | null };

export async function jobOverviewAuthorityDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('admin','electrician','installer','owner','property_manager');
    CREATE TYPE public.assignment_role AS ENUM ('electrician','installer','property_manager');
    CREATE TYPE public.authority_status AS ENUM ('not_requested','sent','viewed','accepted','declined','expired','revoked');
    CREATE TYPE public.quote_kind AS ENUM ('installation','rectification','repeat_safety_check');
    CREATE TYPE public.job_stage AS ENUM ('new_enquiry','complete','cancelled');
    CREATE TYPE public.eligibility_outcome AS ENUM ('likely_eligible','needs_onsite_confirmation','does_not_appear_eligible');
    CREATE TYPE public.job_channel AS ENUM ('hivic_sourced','installer_sourced');
    CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
    CREATE TABLE public.owners (id uuid PRIMARY KEY, user_id uuid, full_name text, phone text, email text);
    CREATE TABLE public.properties (id uuid PRIMARY KEY, address_line text, suburb text, state text, postcode text);
    CREATE TABLE public.profiles (id uuid PRIMARY KEY, full_name text, business_id uuid);
    CREATE TABLE public.businesses (id uuid PRIMARY KEY, name text);
    CREATE TABLE public.business_members (business_id uuid, user_id uuid, member_role text, active boolean);
    CREATE TABLE public.partner_workers (id uuid, profile_id uuid, trade_role public.assignment_role, approval_status text, removed_at timestamptz);
    CREATE TABLE public.worker_job_links (job_id uuid, worker_id uuid, business_id uuid, revoked_at timestamptz, expires_at timestamptz);
    CREATE TABLE public.jobs (
      id uuid PRIMARY KEY, job_number text, stage public.job_stage, next_action text,
      eligibility_outcome public.eligibility_outcome, life_support boolean, last_activity_at timestamptz, created_at timestamptz, hold_reason text,
      property_id uuid, owner_id uuid, channel public.job_channel, commercial_model text,
      originating_installer_user_id uuid, originating_installer_business_id uuid, source text,
      eligibility_review_required boolean, eligibility_flags text[], deleted_at timestamptz
    );
    CREATE TABLE public.job_assignments (job_id uuid, user_id uuid, business_id uuid, active boolean, role public.assignment_role);
    CREATE TABLE public.job_piesa_deadlines (job_id uuid, piesa_date date, install_deadline date, days_remaining integer, urgency text, piesa_expired boolean);
    CREATE TABLE public.invoice_status (job_id uuid, effective_status text, kind public.quote_kind, created_at timestamptz);
    CREATE TABLE public.owner_authorities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES jobs(id), version integer NOT NULL, status public.authority_status NOT NULL, expires_at timestamptz, UNIQUE(job_id,version));
  `);
  for (const [source, name] of [
    [core, "has_role"], [core, "is_admin"], [core, "is_job_owner"],
    [read("drizzle/migrations/0023_reinsulate_pilot_partner_network.sql"), "is_business_member"],
    [read("drizzle/migrations/0115_trade_job_access.sql"), "job_assignment_role"],
    [read("drizzle/migrations/0147_job_soft_delete.sql"), "can_access_job"],
    [authorityMigration, "job_authority_status"], [authorityMigration, "job_authority_expires_at"],
  ]) {
    if (!source || !name) throw new Error("Missing function input");
    await db.exec(functionSql(source, name));
  }
  // Extract the exact authority RLS policies from the existing migration, rather than granting trades artificial visibility.
  const policiesStart = authorityMigration.indexOf("alter table public.owner_authorities enable row level security;");
  const policiesEnd = authorityMigration.indexOf("-- Immutability:", policiesStart);
  await db.exec(authorityMigration.slice(policiesStart, policiesEnd));
  const format = read("drizzle/migrations/0055_canonical_property_address.sql");
  await db.exec(format.slice(0, format.indexOf("CREATE OR REPLACE VIEW")));
  await db.exec("CREATE FUNCTION public.job_deposit_cleared(_job uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';");
  await db.exec(`
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon, service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    INSERT INTO user_roles VALUES ('${CALLERS.admin}','admin'),('${CALLERS.installer}','installer'),('${CALLERS.electrician}','electrician'),('${CALLERS.owner}','owner');
    INSERT INTO owners VALUES ('${CALLERS.owner}','${CALLERS.owner}','Practice Owner',null,null);
    INSERT INTO properties VALUES ('${CALLERS.owner}','Practice address','Melbourne','VIC','3000');
    INSERT INTO profiles (id, full_name) VALUES ('${CALLERS.installer}','Practice Installer'),('${CALLERS.electrician}','Practice Electrician');
  `);
  const cases = ["none", "requested", "accepted", "expired", "versions", "null-expiry"];
  for (const [index, label] of cases.entries()) {
    const jobId = `00000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`;
    await db.query("INSERT INTO jobs (id,job_number,stage,property_id,owner_id,source) VALUES ($1,$2,'new_enquiry',$3,$3,'qa_test')", [jobId, label, CALLERS.owner]);
    await db.query("INSERT INTO job_assignments (job_id,user_id,active,role) VALUES ($1,$2,true,'installer'),($1,$3,true,'electrician')", [jobId, CALLERS.installer, CALLERS.electrician]);
    if (label !== "none") {
      await db.query("INSERT INTO owner_authorities (job_id,version,status,expires_at) VALUES ($1,1,$2,$3)", [jobId, label === "requested" ? "sent" : "accepted", label === "expired" ? "2000-01-01T00:00:00Z" : label === "null-expiry" ? null : "2099-01-01T00:00:00Z"]);
    }
    if (label === "versions") await db.query("INSERT INTO owner_authorities (job_id,version,status,expires_at) VALUES ($1,2,'viewed','2098-01-01T00:00:00Z')", [jobId]);
  }
  await db.exec(currentOverviewSql);
  await db.exec("GRANT SELECT ON public.job_overview TO anon, authenticated; GRANT ALL ON public.job_overview TO service_role;");
  const as = <T,>(user: string, sql: string) => db.transaction(async (tx) => {
    await tx.exec("SET LOCAL ROLE authenticated");
    await tx.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
    return (await tx.query<T>(sql)).rows;
  });
  const rows = (user: string) => as<AuthorityRow>(user, "SELECT job_number,authority_status,authority_expires_at FROM public.job_overview ORDER BY job_number");
  const metadata = async () => ({
    columns: (await db.query("SELECT attname,atttypid,atttypmod FROM pg_attribute WHERE attrelid='public.job_overview'::regclass AND attnum>0 ORDER BY attnum")).rows,
    settings: (await db.query("SELECT relowner,reloptions,relacl FROM pg_class WHERE oid='public.job_overview'::regclass")).rows,
  });
  return { db, rows, metadata };
}