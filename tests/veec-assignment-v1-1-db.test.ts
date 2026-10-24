// Proves docs/pending-migrations/0225_veec_assignment_v1_1.sql on PGlite (in-process; nothing live). Mirrors the live
// compliance_templates columns, the one-active unique index and the approval guard trigger (0014 + 0019 + 0025).
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { VEEC_FORM_BODY, VEEC_FORM_FIELDS, VEEC_FORM_VERSION } from "../src/lib/veec-assignment-form.core";

const MIG = join(import.meta.dir, "..", "docs", "pending-migrations");
const SQL = readFileSync(join(MIG, "0225_veec_assignment_v1_1.sql"), "utf8");
const ROLLBACK = readFileSync(join(MIG, "0225_veec_assignment_v1_1.rollback.sql"), "utf8");

async function db() {
  const d = new PGlite();
  await d.exec(`
    CREATE TABLE public.profiles (id uuid primary key);
    CREATE TABLE public.compliance_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      template_key text NOT NULL CHECK (template_key = ANY (ARRAY['customer_agreement','consumer_rights','esc_consent','installer_declaration','consumer_declaration','ap_declaration','partner_agreement'])),
      version text NOT NULL, body text NOT NULL, required boolean NOT NULL DEFAULT true, approved boolean NOT NULL DEFAULT false,
      approved_by uuid REFERENCES public.profiles(id), approved_at timestamptz, is_active boolean NOT NULL DEFAULT false, source_note text,
      created_by uuid REFERENCES public.profiles(id), created_at timestamptz NOT NULL DEFAULT now(),
      form_fields jsonb NOT NULL DEFAULT '[]'::jsonb, requires_final_consumer_signature boolean NOT NULL DEFAULT false,
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
    -- the two unapproved drafts found live on 20 Oct 2026 (active, never approved)
    INSERT INTO public.compliance_templates (template_key, version, body, approved, is_active, source_note) VALUES
      ('consumer_declaration', 'Activity48-VEEC-Assignment-v16-DRAFT', 'old draft', false, true, 'draft'),
      ('installer_declaration', 'DEECA-PIISA-March-2026-DRAFT', 'old draft', false, true, NULL),
      ('consumer_rights', 'rights-v1', 'rights', true, true, 'approved');
  `);
  return d;
}
const row = async (d: PGlite, version: string) => (await d.query<{ approved: boolean; is_active: boolean; body: string; form_fields: unknown; source_note: string | null; required: boolean }>("select approved, is_active, body, form_fields, source_note, required from public.compliance_templates where version = $1", [version])).rows[0];

describe("0225 VEEC assignment v1.1 template row", () => {
  test("inserts the official wording unapproved and inactive, idempotently; drafts stay and are annotated", async () => {
    const d = await db();
    await d.exec(SQL); await d.exec(SQL);
    const r = await row(d, VEEC_FORM_VERSION);
    expect(r).toBeDefined();
    expect(r!.approved).toBe(false); expect(r!.is_active).toBe(false); expect(r!.required).toBe(true);
    expect(r!.body).toBe(VEEC_FORM_BODY);
    expect(r!.form_fields).toEqual(JSON.parse(JSON.stringify(VEEC_FORM_FIELDS)));
    expect(r!.body).toContain("Do not change" === "" ? "" : "I declare that:");
    const n = await d.query<{ n: number }>("select count(*)::int n from public.compliance_templates where template_key = 'consumer_declaration'");
    expect(n.rows[0]!.n).toBe(2);
    expect((await row(d, "Activity48-VEEC-Assignment-v16-DRAFT"))!.source_note).toBe(`draft | Superseded by ${VEEC_FORM_VERSION} (decisions 118a/119, 24 Oct 2026); kept as history.`);
    expect((await row(d, "DEECA-PIISA-March-2026-DRAFT"))!.source_note).toMatch(/^Superseded by/);
    expect((await row(d, "Activity48-VEEC-Assignment-v16-DRAFT"))!.is_active).toBe(true); // the office swaps the active row in Compliance Setup, never the migration
    expect((await row(d, "rights-v1"))!.source_note).toBe("approved");
  });
  test("approval guard still protects the row once approved; rollback leaves it inactive and strips the annotation", async () => {
    const d = await db();
    await d.exec(SQL);
    await d.exec(`update public.compliance_templates set is_active = false where version = 'Activity48-VEEC-Assignment-v16-DRAFT'`);
    await d.exec(`update public.compliance_templates set approved = true, is_active = true where version = '${VEEC_FORM_VERSION}'`);
    await expect(d.exec(`update public.compliance_templates set body = 'changed' where version = '${VEEC_FORM_VERSION}'`)).rejects.toThrow(/immutable/);
    await expect(d.exec(`delete from public.compliance_templates where version = '${VEEC_FORM_VERSION}'`)).rejects.toThrow(/permanent/);
    await d.exec(ROLLBACK);
    const r = await row(d, VEEC_FORM_VERSION);
    expect(r!.is_active).toBe(false); expect(r!.approved).toBe(false);
    expect((await row(d, "Activity48-VEEC-Assignment-v16-DRAFT"))!.source_note).toBe("draft");
    expect((await row(d, "DEECA-PIISA-March-2026-DRAFT"))!.source_note).toBeNull();
  });
});
