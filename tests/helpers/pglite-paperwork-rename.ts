import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { GATE_DOCS } from "../../src/lib/owner-gates.core";

export const OLD_PAPERWORK_VERSION = "lawyer-2026-10-06-v1";
export const NEW_PAPERWORK_VERSION = "2026-10-06-v1";
export const APPROVER = "00000000-0000-4000-8000-000000000001";
export const APPROVED_AT = "2026-10-06T00:00:00.000Z";
export const hashBody = (body: string) => createHash("sha256").update(body).digest("hex");
const sql = (name: string) => readFileSync(new URL(`../../docs/pending-migrations/${name}`, import.meta.url), "utf8");

export async function paperworkRenameDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.profiles (id uuid PRIMARY KEY);
    INSERT INTO public.profiles VALUES ('${APPROVER}');
    CREATE TABLE public.jobs (id uuid PRIMARY KEY);
    CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS 'SELECT true';
  `);
  await db.exec(readFileSync(new URL("../../drizzle/migrations/0121_owner_paperwork.sql", import.meta.url), "utf8"));
  await db.exec(`
    CREATE TABLE public.compliance_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      template_key text NOT NULL CHECK (template_key IN ('customer_agreement','consumer_rights','esc_consent','installer_declaration','consumer_declaration','ap_declaration','partner_agreement')),
      version text NOT NULL, body text NOT NULL, required boolean NOT NULL DEFAULT true,
      approved boolean NOT NULL DEFAULT false, approved_by uuid REFERENCES public.profiles(id),
      approved_at timestamptz, is_active boolean NOT NULL DEFAULT false, source_note text,
      created_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
      form_fields jsonb NOT NULL DEFAULT '[]', requires_final_consumer_signature boolean NOT NULL DEFAULT false,
      UNIQUE(template_key, version)
    );
    CREATE UNIQUE INDEX compliance_templates_one_active ON public.compliance_templates(template_key) WHERE is_active;
  `);
  const fixtures = JSON.parse(readFileSync(new URL("../fixtures/live-triggers-2026-10-26.json", import.meta.url), "utf8"));
  const definitions: string[] = Object.values(fixtures).flatMap((value: unknown) => Array.isArray(value) ? value : []).filter((value: unknown): value is string => typeof value === "string");
  const guard = definitions.find((definition) => definition.startsWith("CREATE OR REPLACE FUNCTION public.guard_compliance_template()"));
  if (!guard) throw new Error("Missing real compliance template guard fixture");
  await db.exec(guard);
  await db.exec(`CREATE TRIGGER compliance_templates_guard BEFORE UPDATE OR DELETE ON public.compliance_templates FOR EACH ROW EXECUTE FUNCTION public.guard_compliance_template();
    CREATE TABLE public.customer_agreements (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), snapshot jsonb NOT NULL);
    CREATE TABLE public.signed_copies (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), content text NOT NULL);
    INSERT INTO public.jobs VALUES ('${APPROVER}');
    INSERT INTO public.owner_gate_signatures (job_id, gate, doc_key, doc_version, doc_draft, signed_text, signed_text_sha256, signatory_name, ticked, method)
    VALUES ('${APPROVER}', 'B', 'quote_acceptance', '${OLD_PAPERWORK_VERSION}', false, 'unchanged signed wording', 'signed-hash', 'Test Owner', true, 'login');
    INSERT INTO public.customer_agreements (snapshot) VALUES ('{"version":"${OLD_PAPERWORK_VERSION}","text":"unchanged signed agreement"}');
    INSERT INTO public.signed_copies (content) VALUES ('unchanged signed copy');
  `);
  for (const doc of GATE_DOCS.filter((doc) => doc.version === OLD_PAPERWORK_VERSION || doc.version === NEW_PAPERWORK_VERSION)) {
    await db.query("INSERT INTO public.owner_paperwork_approvals (doc_key, doc_version, body_sha256, approved_by, approved_at) VALUES ($1,$2,$3,$4,$5)", [doc.key, OLD_PAPERWORK_VERSION, hashBody(doc.body), APPROVER, APPROVED_AT]);
  }
  await db.query("INSERT INTO public.compliance_templates (template_key, version, body, approved, approved_by, approved_at, is_active, source_note) VALUES ('consumer_rights',$1,'unchanged consumer rights',true,$2,$3,true,'Jo Lowe — lawyer sign-off 6 Oct 2026')", [OLD_PAPERWORK_VERSION, APPROVER, APPROVED_AT]);
  return db;
}

export const applyPaperworkRename = (db: PGlite) => db.exec(sql("paperwork-version-rename.sql"));
export const rollbackPaperworkRename = (db: PGlite) => db.exec(sql("paperwork-version-rename.rollback.sql"));
export async function matchingApprovals(db: PGlite): Promise<Record<string, string>> {
  const { rows } = await db.query<{ doc_key: string; doc_version: string; body_sha256: string }>("SELECT doc_key, doc_version, body_sha256 FROM public.owner_paperwork_approvals");
  return Object.fromEntries(GATE_DOCS.filter((doc) => rows.some((row) => row.doc_key === doc.key && row.doc_version === doc.version && row.body_sha256 === hashBody(doc.body))).map((doc) => [doc.key, doc.version]));
}
export async function signedRecords(db: PGlite) {
  return Promise.all(["owner_gate_signatures", "customer_agreements", "signed_copies"].map(async (table) => (await db.query(`SELECT * FROM public.${table} ORDER BY id`)).rows));
}