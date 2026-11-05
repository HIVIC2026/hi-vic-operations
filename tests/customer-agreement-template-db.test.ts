// Practice database (PGlite) proof for the Customer Agreement v1.3 pending migration.
import { beforeEach, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { CUSTOMER_AGREEMENT_V1_3, CUSTOMER_AGREEMENT_V1_4 } from "../src/lib/customer-agreement.core";

const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const JO = "950fa0b6-dc44-49af-a754-6a65f26a661e";
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
CREATE TRIGGER compliance_templates_guard BEFORE UPDATE OR DELETE ON public.compliance_templates FOR EACH ROW EXECUTE FUNCTION public.guard_compliance_template();`;
let db: PGlite;
const q = (s: string) => db.query<Record<string, unknown>>(s);
const SEED_OLD = `INSERT INTO public.compliance_templates (template_key, version, body, approved, approved_by, approved_at, is_active)
  VALUES ('customer_agreement', '1.2', 'older body text long enough', true, '${JO}', '2026-10-01', true);`;
beforeEach(async () => { db = new PGlite(); await db.exec(BASE); });
const apply = () => db.exec(read("customer-agreement-v1-3.sql"));

describe("Customer Agreement v1.3 template (practice database)", () => {
  beforeEach(async () => { await apply(); });
  test("an older active row is retired first and kept as history", async () => {
    db = new PGlite(); await db.exec(BASE); await db.exec(SEED_OLD); await apply();
    const r = await q("select version, approved, is_active from compliance_templates where template_key='customer_agreement' order by version");
    expect(r.rows).toEqual([{ version: "1.2", approved: true, is_active: false }, { version: "1.3", approved: true, is_active: true }]);
  });
  test("fails closed (nothing changed) when v1.3 exists but is not approved and active", async () => {
    db = new PGlite(); await db.exec(BASE); await db.exec(SEED_OLD);
    await db.exec("INSERT INTO public.compliance_templates (template_key, version, body) VALUES ('customer_agreement','1.3','draft body text long enough')");
    await expect(apply()).rejects.toThrow(/not approved and active/);
    await db.exec("ROLLBACK"); // a real session ends the aborted transaction; PGlite exec leaves it open
    const r = await q("select version, is_active from compliance_templates where template_key='customer_agreement' order by version");
    expect(r.rows).toEqual([{ version: "1.2", is_active: true }, { version: "1.3", is_active: false }]);
  });
  test("v1.3 is the one approved, active customer_agreement", async () => {
    const r = await q("select version, approved, is_active, approved_by, body from compliance_templates where template_key='customer_agreement'");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ version: "1.3", approved: true, is_active: true, approved_by: JO, body: CUSTOMER_AGREEMENT_V1_3 });
  });
  test("no stored text mentions a lawyer", async () => {
    const r = await q("select body, source_note from compliance_templates where template_key='customer_agreement'");
    expect(JSON.stringify(r.rows)).not.toMatch(/lawyer/i);
  });
  test("running twice is safe", async () => {
    await apply();
    expect((await q("select 1 from compliance_templates where template_key='customer_agreement'")).rows).toHaveLength(1);
  });
  test("approved wording is immutable", async () => {
    await expect(db.query("update compliance_templates set body='x' where template_key='customer_agreement'")).rejects.toThrow(/immutable/);
  });
  test("a later version replaces it through the Settings approval path", async () => {
    await db.query("insert into compliance_templates (template_key, version, body) values ('customer_agreement','1.4','next body text long enough')");
    await db.query("update compliance_templates set is_active=false where template_key='customer_agreement' and is_active");
    await db.query("update compliance_templates set approved=true, is_active=true where template_key='customer_agreement' and version='1.4'");
    const r = await q("select version from compliance_templates where template_key='customer_agreement' and approved and is_active");
    expect(r.rows).toEqual([{ version: "1.4" }]);
  });
  test("rollback re-activates the older approved row the forward script retired", async () => {
    db = new PGlite(); await db.exec(BASE); await db.exec(SEED_OLD); await apply();
    await db.exec(read("customer-agreement-v1-3.rollback.sql"));
    const r = await q("select version, approved, is_active from compliance_templates where template_key='customer_agreement' order by version");
    expect(r.rows).toEqual([{ version: "1.2", approved: true, is_active: true }]);
    const t = await q("select tgenabled from pg_trigger where tgname='compliance_templates_guard'");
    expect(t.rows).toEqual([{ tgenabled: "O" }]);
  });
  test("rollback with no older row leaves no customer_agreement", async () => {
    await db.exec(read("customer-agreement-v1-3.rollback.sql"));
    expect((await q("select 1 from compliance_templates where template_key='customer_agreement'")).rows).toHaveLength(0);
  });
});

describe("Customer Agreement v1.4 — 50% deposit (Jo 5 Nov 2026, practice database)", () => {
  const apply4 = () => db.exec(read("customer-agreement-v1-4.sql"));
  beforeEach(async () => { await apply(); await apply4(); });
  test("v1.4 is the one active row; v1.3 stays, unchanged, as history", async () => {
    const r = await q("select version, approved, is_active, body from compliance_templates where template_key='customer_agreement' order by version");
    expect(r.rows.map((x) => [x["version"], x["approved"], x["is_active"]])).toEqual([["1.3", true, false], ["1.4", true, true]]);
    expect(r.rows[0]!["body"]).toBe(CUSTOMER_AGREEMENT_V1_3);
    expect(r.rows[1]!["body"]).toBe(CUSTOMER_AGREEMENT_V1_4);
  });
  test("running twice is safe", async () => {
    await apply4();
    expect((await q("select 1 from compliance_templates where template_key='customer_agreement'")).rows).toHaveLength(2);
  });
  test("rollback re-activates v1.3", async () => {
    await db.exec(read("customer-agreement-v1-4.rollback.sql"));
    const r = await q("select version, is_active from compliance_templates where template_key='customer_agreement' order by version");
    expect(r.rows).toEqual([{ version: "1.3", is_active: true }]);
  });
});
