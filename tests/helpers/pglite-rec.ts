// Isolated in-process PostgreSQL (PGlite) with the production REC tables' relevant columns, the
// real production triggers, the unique office-entry key, and the PENDING sign_rec_application SQL.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { RecSignApp, RecSignDeps } from "../../src/lib/rec-sign.core";

export const PENDING_SQL = readFileSync(new URL("../../docs/pending-migrations/0078_sign_rec_application.sql", import.meta.url), "utf8");
const SCHEMA = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.partner_enquiries (
  id uuid primary key default gen_random_uuid(), enquiry_type text not null, submission_id text not null, source_system text not null default 'base44',
  source text, status text not null default 'new', name text, email text, phone text, company text, service_areas text[], rec_registration_number text,
  esv_licensed_electricians_confirmed boolean, services text[], estimated_piesa_fee_inc_gst numeric, booking_lead_time text, weekly_capacity text,
  raw_payload jsonb, source_created_at timestamptz, source_updated_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
CREATE UNIQUE INDEX partner_enquiries_source_uniq ON public.partner_enquiries(source_system, enquiry_type, submission_id);
CREATE TABLE public.rec_onboarding_applications (
  id uuid primary key default gen_random_uuid(), resume_token_hash text, status text not null default 'draft', step_key text, data jsonb not null default '{}',
  insurance_certificate_path text, agreement_version text, agreement_title text, agreement_text text, agreement_sha256 text, acknowledgements jsonb,
  signer_name text, signer_position text, signer_email text, signed_at timestamptz, signed_ip text, signed_user_agent text, partner_enquiry_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), partner_type text not null default 'rec', test_mode boolean default false, allow_incomplete_sign boolean default false);
CREATE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := clock_timestamp(); RETURN NEW; END $$;
CREATE TRIGGER partner_enquiries_touch BEFORE UPDATE ON public.partner_enquiries FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
-- production guard_rec_onboarding_signed (now() -> clock_timestamp() so separate test statements get distinct revisions)
CREATE FUNCTION public.guard_rec_onboarding_signed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN IF OLD.status = 'submitted' THEN RAISE EXCEPTION 'Signed REC onboarding records are permanent'; END IF; RETURN OLD; END IF;
  IF OLD.status = 'submitted' THEN
    IF (to_jsonb(NEW) - 'partner_enquiry_id' - 'updated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'partner_enquiry_id' - 'updated_at') THEN RAISE EXCEPTION 'Signed REC onboarding records cannot be changed'; END IF;
  END IF;
  NEW.updated_at := clock_timestamp(); RETURN NEW;
END $$;
CREATE TRIGGER rec_onboarding_signed_guard BEFORE DELETE OR UPDATE ON public.rec_onboarding_applications FOR EACH ROW EXECUTE FUNCTION guard_rec_onboarding_signed();
`;

export const sha256 = async (s: string) => createHash("sha256").update(s).digest("hex");

export async function recDb() {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(PENDING_SQL);
  const app = async (id: string): Promise<RecSignApp & Record<string, unknown>> =>
    (await db.query<RecSignApp & Record<string, unknown>>(`SELECT *, updated_at::text AS updated_at, created_at::text AS created_at FROM rec_onboarding_applications WHERE id = $1`, [id])).rows[0]!;
  const create = async (data: unknown) => {
    const r = await db.query<{ id: string }>(`INSERT INTO rec_onboarding_applications(data, insurance_certificate_path) VALUES ($1, 'rec/x/coc.pdf') RETURNING id`, [JSON.stringify(data)]);
    return r.rows[0]!.id;
  };
  const save = async (id: string, data: unknown) => { await db.query(`UPDATE rec_onboarding_applications SET data = $2 WHERE id = $1 AND status = 'draft'`, [id, JSON.stringify(data)]); };
  const enquiries = async () => (await db.query<{ id: string; submission_id: string; raw_payload: { agreement_sha256: string; signer: { name: string } }; estimated_piesa_fee_inc_gst: string | null; status: string }>(`SELECT * FROM partner_enquiries`)).rows;
  const deps = (before?: () => Promise<void>): RecSignDeps => ({
    sha256,
    signAtomic: async ({ appId, expectedUpdatedAt, agreementSha256, enquiry, signed }) => {
      if (before) await before();
      const r = await db.query<{ outcome: "signed" | "already_signed_same"; partner_enquiry_id: string; signed_at: Date }>(
        `SELECT * FROM sign_rec_application($1, $2, $3, $4, $5)`, [appId, expectedUpdatedAt, agreementSha256, JSON.stringify(enquiry), JSON.stringify(signed)]);
      const row = r.rows[0]!;
      return { ...row, signed_at: new Date(row.signed_at).toISOString() };
    },
  });
  return { db, app, create, save, enquiries, deps };
}
