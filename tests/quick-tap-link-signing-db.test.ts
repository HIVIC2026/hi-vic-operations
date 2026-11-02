// Practice-database proof for drizzle/migrations/0187_quick_tap_link_signing.sql (applied live 2 Nov 2026) (Jo 2 Nov 2026):
// the quick-taps "Yes, let's go" OK to share details is a tapped-link signature with no code, allowed only for
// trade_contact_share; code sign-ins (link_code) still need their verified code.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const BASE = readFileSync(new URL("../drizzle/migrations/0121_owner_paperwork.sql", import.meta.url), "utf8");
const SQL = readFileSync(new URL("../drizzle/migrations/0187_quick_tap_link_signing.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../docs/applied-migrations/2026-11-02_quick_tap_link_signing.rollback.sql", import.meta.url), "utf8");
const JOB = "00000000-0000-4000-8000-0000000000c1";

async function db(withFix = true) {
  const d = new PGlite();
  await d.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.jobs (id uuid primary key);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    INSERT INTO public.jobs VALUES ('${JOB}');`);
  await d.exec(BASE);
  if (withFix) await d.exec(SQL);
  return d;
}
const sign = (docKey: string, method: string) => `INSERT INTO public.owner_gate_signatures
  (job_id, gate, doc_key, doc_version, doc_draft, signed_text, signed_text_sha256, signatory_name, ticked, method)
  VALUES ('${JOB}','A','${docKey}','v1',false,'text','sha','Wayne Wilson',true,'${method}')`;

describe("quick-tap-link signing (PGlite)", () => {
  test("before the fix, a quick-taps OK with no code is rejected (the live bug)", async () => {
    const d = await db(false);
    await expect(d.exec(sign("trade_contact_share", "link_code"))).rejects.toThrow();
  });
  test("quick_tap_link saves the sharing OK with no code", async () => {
    const d = await db();
    await d.exec(sign("trade_contact_share", "quick_tap_link"));
    const r = await d.query<{ n: number }>(`SELECT count(*)::int n FROM public.owner_gate_signatures WHERE method='quick_tap_link'`);
    expect(r.rows[0]!.n).toBe(1);
  });
  test("quick_tap_link is refused for any other document", async () => {
    const d = await db();
    await expect(d.exec(sign("quote_acceptance", "quick_tap_link"))).rejects.toThrow();
  });
  test("link_code with no code is still refused", async () => {
    const d = await db();
    await expect(d.exec(sign("trade_contact_share", "link_code"))).rejects.toThrow();
  });
  test("applies twice and rolls back to the old rule", async () => {
    const d = await db();
    await d.exec(SQL);
    await d.exec(ROLLBACK);
    await expect(d.exec(sign("trade_contact_share", "quick_tap_link"))).rejects.toThrow();
    await d.exec(ROLLBACK);
  });
});
