// Isolated in-process PostgreSQL (PGlite) with the relevant production columns, triggers and unique keys, plus the
// PENDING 0082 installer signing/activation SQL exactly as staged. Never touches the live database.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { InstallerSignApp, InstallerSignDeps } from "../../src/lib/installer-sign.core";

export const PENDING_SQL = readFileSync(new URL("../../docs/pending-migrations/0082_installer_sign_activation.sql", import.meta.url), "utf8");
const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE app_role AS ENUM ('admin','electrician','installer','owner');
CREATE TYPE business_type AS ENUM ('rec','eec_installer');
CREATE TYPE assignment_role AS ENUM ('electrician','installer');
CREATE TYPE rate_card_kind AS ENUM ('electrical','installer');
CREATE TABLE public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role app_role not null);
CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.partner_enquiries (
  id uuid primary key default gen_random_uuid(), enquiry_type text not null, submission_id text not null, source_system text not null default 'base44',
  source text, status text not null default 'new', name text, email text, phone text, company text, service_areas text[],
  cii_certification_status text, cii_certification_details text, services text[],
  estimated_r5_install_rate_per_sqm_inc_gst numeric, estimated_batts_removal_rate_per_sqm_inc_gst numeric, estimated_loose_fill_removal_rate_per_sqm_inc_gst numeric,
  free_quotes_for_hivic_leads boolean, free_measureups_for_hivic_quote_leads boolean, booking_lead_time text, weekly_capacity text,
  raw_payload jsonb, source_created_at timestamptz, source_updated_at timestamptz, approved_at timestamptz, status_changed_by uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE UNIQUE INDEX partner_enquiries_source_uniq ON public.partner_enquiries(source_system, enquiry_type, submission_id);
CREATE TABLE public.rec_onboarding_applications (
  id uuid primary key default gen_random_uuid(), resume_token_hash text, status text not null default 'draft', step_key text, data jsonb not null default '{}',
  insurance_certificate_path text, agreement_version text, agreement_title text, agreement_text text, agreement_sha256 text, acknowledgements jsonb,
  signer_name text, signer_position text, signer_email text, signed_at timestamptz, signed_ip text, signed_user_agent text, partner_enquiry_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), partner_type text not null default 'installer', test_mode boolean default false, allow_incomplete_sign boolean default false);
CREATE FUNCTION public.guard_rec_onboarding_signed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'Signed REC onboarding records are permanent'; END IF; RETURN OLD; END IF;
  IF OLD.status = 'submitted' THEN
    IF (to_jsonb(NEW) - 'partner_enquiry_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'partner_enquiry_id' - 'updated_at') THEN RAISE EXCEPTION 'Signed REC onboarding records cannot be changed'; END IF;
  END IF;
  NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER rec_onboarding_signed_guard BEFORE DELETE OR UPDATE ON public.rec_onboarding_applications FOR EACH ROW EXECUTE FUNCTION guard_rec_onboarding_signed();
CREATE TABLE public.electrician_nominations (
  id uuid primary key default gen_random_uuid(), job_id uuid, installer_application_id uuid, nominated_for text not null default 'installer', contact_name text not null,
  business_name text, email text, phone text, licence_number text, rec_number text, status text not null default 'invite_pending_comms', is_primary boolean not null default false,
  consent_confirmed_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE UNIQUE INDEX electrician_nominations_app_email_uidx ON public.electrician_nominations (installer_application_id, lower(email)) WHERE installer_application_id IS NOT NULL AND job_id IS NULL AND email IS NOT NULL;
CREATE TABLE public.businesses (
  id uuid primary key default gen_random_uuid(), name text not null, legal_name text, trading_name text, abn text, business_type business_type not null,
  is_active boolean not null default true, capabilities text[] not null default '{}', email text, phone text, address text, gst_registered boolean,
  service_regions text[] not null default '{}', declared_service_origin text, declared_travel_radius_km integer, declared_excluded_areas text,
  free_measureups_for_hivic_quote_leads boolean, weekly_capacity integer, rec_number text, installer_certification jsonb not null default '{}',
  onboarding_status text not null default 'draft', approved_by uuid, approved_at timestamptz, xero_contact_status text not null default 'not_ready',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE TABLE public.partner_workers (
  id uuid primary key default gen_random_uuid(), business_id uuid not null references businesses(id), trade_role assignment_role not null, full_legal_name text not null,
  email text not null, mobile text, licence_number text, qualification text, source_application_id uuid, profile_id uuid unique,
  account_status text not null default 'awaiting_account', approval_status text not null default 'pending',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (business_id, email));
CREATE TABLE public.business_credentials (
  id uuid primary key default gen_random_uuid(), business_id uuid not null, kind text not null, label text, number text, issuer text, expires_at date, critical boolean,
  document_path text, verification text, verified_by uuid, verified_at timestamptz, created_by uuid);
CREATE TABLE public.rate_cards (id uuid primary key default gen_random_uuid(), kind rate_card_kind not null, business_id uuid, name text not null, version integer not null, is_active boolean not null default false, unique (kind, business_id, version));
CREATE TABLE public.rate_card_items (id uuid primary key default gen_random_uuid(), rate_card_id uuid not null references rate_cards(id), code text not null, description text, category text, unit text,
  unit_price_ex_gst numeric not null CHECK (unit_price_ex_gst > 0), r_value numeric, sort integer, display_unit text);
CREATE TABLE public.partner_agreements (id uuid primary key default gen_random_uuid(), business_id uuid not null, version text, body text, signer_name text, signed_at timestamptz, ip text, user_agent text, snapshot jsonb, snapshot_sha256 text);
CREATE TABLE public.business_bank_details (business_id uuid primary key, account_name text, bsb text, account_number text, updated_by uuid, updated_at timestamptz, supplied_at timestamptz, supplied_by uuid, review_status text, reviewed_by uuid, reviewed_at timestamptz);
CREATE TABLE public.business_bank_detail_events (id uuid primary key default gen_random_uuid(), business_id uuid not null, actor_id uuid not null, event_type text not null, details jsonb not null default '{}', created_at timestamptz not null default now());
CREATE TABLE public.partner_activations (id uuid primary key default gen_random_uuid(), application_id uuid unique, partner_enquiry_id uuid, business_id uuid, partner_type text, rate_card_id uuid, activated_by uuid, override_reason text, snapshot jsonb);
`;

export const sha256 = async (s: string) => createHash("sha256").update(s).digest("hex");
export const ADMIN = "11111111-1111-1111-1111-111111111111";

export async function installerDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(PENDING_SQL);
  await db.query(`INSERT INTO user_roles(user_id, role) VALUES ($1, 'admin')`, [ADMIN]);
  const app = async (id: string): Promise<InstallerSignApp & Record<string, unknown>> =>
    (await db.query<InstallerSignApp & Record<string, unknown>>(`SELECT *, to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at, created_at::text AS created_at FROM rec_onboarding_applications WHERE id = $1`, [id])).rows[0]!;
  const create = async (data: unknown) => {
    const r = await db.query<{ id: string }>(`INSERT INTO rec_onboarding_applications(data, insurance_certificate_path) VALUES ($1, 'installer/x/coc.pdf') RETURNING id`, [JSON.stringify(data)]);
    return r.rows[0]!.id;
  };
  const save = async (id: string, data: unknown) => { await db.query(`UPDATE rec_onboarding_applications SET data = $2 WHERE id = $1 AND status = 'draft'`, [id, JSON.stringify(data)]); };
  const count = async (table: string) => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0]!.n);
  const deps = (before?: () => Promise<void>): InstallerSignDeps => ({
    sha256,
    signAtomic: async ({ appId, expectedUpdatedAt, agreementSha256, enquiry, signed, nominations }) => {
      if (before) await before();
      const r = await db.query<{ outcome: "signed" | "already_signed_same"; partner_enquiry_id: string; signed_at: Date }>(
        `SELECT * FROM sign_installer_application($1, $2, $3, $4, $5, $6)`,
        [appId, expectedUpdatedAt, agreementSha256, JSON.stringify(enquiry), JSON.stringify(signed), JSON.stringify(nominations)]);
      const row = r.rows[0]!;
      return { ...row, signed_at: new Date(row.signed_at).toISOString() };
    },
  });
  const activate = async (appId: string, plan: unknown, actor = ADMIN, override: string | null = null) =>
    (await db.query<{ outcome: string; business_id: string; rate_card_id: string }>(`SELECT * FROM activate_partner_application($1, $2, $3, $4)`, [appId, actor, override, JSON.stringify(plan)])).rows[0]!;
  return { db, app, create, save, count, deps, activate };
}
