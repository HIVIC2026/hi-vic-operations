// Practice database (PGlite) proof for 0226: the ESC Owner's Consent Form Template v1 becomes the active esc_consent
// wording (approved by Jo's admin user), the lawyer row stays as inactive history, and the two consent columns exist.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { parseFormFields } from "../src/lib/assignment.core";
import {
  ESC_AP_FULL_NAME,
  ESC_CONSENT_TEMPLATE_VERSION,
  OWNER_DECLARATIONS,
} from "../src/lib/consent.core";

const read = (f: string) =>
  readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const JO = "950fa0b6-dc44-49af-a754-6a65f26a661e";
const PAPERWORK = "2026-10-06-v1";
// Live shape of compliance_templates (0014 + 0017/0024 key check + 0019 form_fields/guard) and the columns of
// owner_esc_consents that 0226 touches (0022).
const BASE = `
CREATE TABLE public.profiles (id uuid primary key, full_name text);
INSERT INTO public.profiles VALUES ('${JO}', 'Jo Lowe');
CREATE TABLE public.compliance_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL CHECK (template_key = ANY (ARRAY['customer_agreement','consumer_rights','esc_consent','installer_declaration','consumer_declaration','ap_declaration','partner_agreement']::text[])),
  version text NOT NULL, body text NOT NULL, required boolean NOT NULL DEFAULT true, approved boolean NOT NULL DEFAULT false,
  approved_by uuid REFERENCES public.profiles(id), approved_at timestamptz, is_active boolean NOT NULL DEFAULT false, source_note text,
  created_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
  form_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (template_key, version));
CREATE UNIQUE INDEX compliance_templates_one_active ON public.compliance_templates(template_key) WHERE is_active;
CREATE OR REPLACE FUNCTION public.guard_compliance_template() RETURNS trigger LANGUAGE plpgsql AS $$
begin
  if tg_op = 'DELETE' then raise exception 'compliance templates are permanent records'; end if;
  if old.approved and (new.body <> old.body or new.version <> old.version or new.template_key <> old.template_key or new.form_fields is distinct from old.form_fields) then
    raise exception 'approved template wording/fields are immutable – create a new version';
  end if;
  return new;
end $$;
CREATE TRIGGER compliance_templates_guard BEFORE UPDATE OR DELETE ON public.compliance_templates FOR EACH ROW EXECUTE FUNCTION public.guard_compliance_template();
INSERT INTO public.compliance_templates (template_key, version, body, approved, approved_by, approved_at, is_active, source_note)
VALUES ('esc_consent', '${PAPERWORK}', 'I give written consent ... my install day(s) ({dates}) ...', true, '${JO}', '2026-10-06T00:00:00Z', true, 'Approved by Jo, 6 Oct 2026');
CREATE TABLE public.owner_esc_consents (id uuid primary key default gen_random_uuid(), job_id uuid not null, status text not null default 'awaiting_owner', template_version text, snapshot jsonb not null default '{}'::jsonb);`;

type Row = {
  version: string;
  approved: boolean;
  is_active: boolean;
  approved_by: string | null;
  body: string;
  form_fields: unknown;
  source_note: string | null;
};
let db: PGlite;
const rows = async () =>
  (
    await db.query<Row>(
      "SELECT version, approved, is_active, approved_by, body, form_fields, source_note FROM public.compliance_templates WHERE template_key = 'esc_consent' ORDER BY version",
    )
  ).rows;
const active = async () => (await rows()).filter((r) => r.is_active).map((r) => r.version);

beforeEach(async () => {
  db = new PGlite();
  await db.exec(BASE);
});

describe("0226 ESC owner consent template (practice database)", () => {
  test("before: the lawyer wording is the active esc_consent", async () => {
    expect(await active()).toEqual([PAPERWORK]);
  });

  test("after: ESC template v1 is the only active, approved row (Jo's admin user); lawyer row kept inactive", async () => {
    await db.exec(read("0226_esc_consent_template_v1.sql"));
    const r = await rows();
    expect(r.map((x) => x.version).sort()).toEqual(
      [ESC_CONSENT_TEMPLATE_VERSION, PAPERWORK].sort(),
    );
    expect(await active()).toEqual([ESC_CONSENT_TEMPLATE_VERSION]);
    const esc = r.find((x) => x.version === ESC_CONSENT_TEMPLATE_VERSION)!;
    expect(esc.approved).toBe(true);
    expect(esc.approved_by).toBe(JO);
    expect(esc.source_note).toContain(
      "e6458b32666a01a5a3d06718cf0ee33b601077761c6f14f77d20bee5d7753151",
    );
    expect(esc.source_note).toContain("ESC-Owners-Consent-Form-Template-v1-20260414.docx");
    const paperwork = r.find((x) => x.version === PAPERWORK);
    expect(paperwork?.is_active).toBe(false);
    expect(paperwork?.approved).toBe(true);
  });

  test("body is Sections 1–3 verbatim with the AP name in the ESC placeholder; no retired lawyer placeholders", async () => {
    await db.exec(read("0226_esc_consent_template_v1.sql"));
    const body = (await rows()).find((x) => x.version === ESC_CONSENT_TEMPLATE_VERSION)!.body;
    const lines = body.split("\n");
    expect(lines[0]).toBe("Section 1: Information to be shared");
    for (const l of [
      "Owner details",
      "First Name:",
      "Last name:",
      "Installation address:",
      "Phone number:",
      "Email address:",
      "Section 2: Declaration by owner",
      "I declare that:",
      "Owner signature:  Date:",
      "Section 3 – Accredited person details and declaration",
      "Part A: Accredited person details",
      "Accredited person details",
      "Accredited person name:",
      "First name:",
      "Role:",
      "Part B: Declaration by accredited person",
      "Accredited person signature:  Date:",
    ])
      expect(lines).toContain(l);
    for (const d of OWNER_DECLARATIONS) expect(lines).toContain(d.text);
    expect(lines).toContain(
      `I <insert name>, am the authorised representative of ${ESC_AP_FULL_NAME} and declare that I have explained to the property owner the purpose for which this written consent is being obtained.`,
    );
    expect(body).not.toContain("<insert name of accredited person>");
    expect(body).not.toContain("{dates}");
    expect(body).not.toContain("START OF TEMPLATE");
  });

  test("form_fields: owner first/last/address/phone/email and the six AP fields, all parseable", async () => {
    await db.exec(read("0226_esc_consent_template_v1.sql"));
    const ff = parseFormFields(
      (await rows()).find((x) => x.version === ESC_CONSENT_TEMPLATE_VERSION)!.form_fields,
    );
    expect(ff.map((f) => f.key)).toEqual([
      "owner_first_name",
      "owner_last_name",
      "installation_address",
      "owner_phone",
      "owner_email",
      "ap_name",
      "ap_first_name",
      "ap_last_name",
      "ap_role",
      "ap_phone",
      "ap_email",
    ]);
    expect(ff.every((f) => f.required)).toBe(true);
    expect(ff.find((f) => f.key === "ap_name")!.help).toContain(ESC_AP_FULL_NAME);
  });

  test("adds owner_declarations and ap_rep to owner_esc_consents; running twice is safe", async () => {
    await db.exec(read("0226_esc_consent_template_v1.sql"));
    await db.exec(read("0226_esc_consent_template_v1.sql"));
    const cols = (
      await db.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'owner_esc_consents'",
      )
    ).rows.map((r) => r.column_name);
    expect(cols).toContain("owner_declarations");
    expect(cols).toContain("ap_rep");
    expect((await rows()).length).toBe(2);
    expect(await active()).toEqual([ESC_CONSENT_TEMPLATE_VERSION]);
    await db.exec(
      `INSERT INTO public.owner_esc_consents (job_id, owner_declarations, ap_rep) VALUES (gen_random_uuid(), '{"owner_or_authorised":true}'::jsonb, '{"first_name":"Jo","last_name":"Lowe","role":"Director"}'::jsonb)`,
    );
  });

  test("approved ESC wording is immutable (existing guard still applies)", async () => {
    await db.exec(read("0226_esc_consent_template_v1.sql"));
    await expect(
      db.exec(
        `UPDATE public.compliance_templates SET body = 'changed' WHERE version = '${ESC_CONSENT_TEMPLATE_VERSION}'`,
      ),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.exec(
        `DELETE FROM public.compliance_templates WHERE version = '${ESC_CONSENT_TEMPLATE_VERSION}'`,
      ),
    ).rejects.toThrow(/permanent/);
  });

  test("rollback reactivates the lawyer wording and keeps the ESC row as history; re-apply restores it", async () => {
    await db.exec(read("0226_esc_consent_template_v1.sql"));
    await db.exec(read("0226_esc_consent_template_v1.rollback.sql"));
    expect(await active()).toEqual([PAPERWORK]);
    expect((await rows()).length).toBe(2);
    await db.exec(read("0226_esc_consent_template_v1.sql"));
    expect(await active()).toEqual([ESC_CONSENT_TEMPLATE_VERSION]);
    expect((await rows()).length).toBe(2);
  });
});
