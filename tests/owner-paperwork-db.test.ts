// Practice-database proof for migration 0121 (owner paperwork gates).
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const SQL = readFileSync(new URL("../docs/pending-migrations/0121_owner_paperwork.sql", import.meta.url), "utf8");
const ROLLBACK = readFileSync(new URL("../docs/pending-migrations/0121_owner_paperwork.rollback.sql", import.meta.url), "utf8");
const JOB = "00000000-0000-4000-8000-0000000000b1";

async function db() {
  const d = new PGlite();
  await d.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.jobs (id uuid primary key);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    INSERT INTO public.jobs VALUES ('${JOB}');`);
  await d.exec(SQL);
  return d;
}
const ins = (extra = "") => `INSERT INTO public.owner_gate_signatures (job_id, gate, doc_key, doc_version, doc_draft, signed_text, signed_text_sha256, signatory_name, ticked, method${extra ? ", verified_channel, verified_destination, code_id" : ""})
  VALUES ('${JOB}','A','contact_privacy','draft-1',true,'text','sha','Pat Owner',true,'${extra ? "link_code" : "login"}'${extra})`;

describe("0121 owner paperwork (PGlite)", () => {
  test("applies twice and rolls back", async () => { const d = await db(); await d.exec(SQL); await d.exec(ROLLBACK); });
  test("link signing must carry the verified code identity", async () => {
    const d = await db();
    await expect(d.exec(`INSERT INTO public.owner_gate_signatures (job_id, gate, doc_key, doc_version, doc_draft, signed_text, signed_text_sha256, signatory_name, ticked, method) VALUES ('${JOB}','A','x','1',true,'t','s','Pat',true,'link_code')`)).rejects.toThrow();
    await d.exec(ins(`, 'sms', '04** *** 123', gen_random_uuid()`));
  });
  test("must be ticked with a typed name", async () => {
    const d = await db();
    await expect(d.exec(`INSERT INTO public.owner_gate_signatures (job_id, gate, doc_key, doc_version, doc_draft, signed_text, signed_text_sha256, signatory_name, ticked, method) VALUES ('${JOB}','A','x','1',true,'t','s','Pat',false,'login')`)).rejects.toThrow();
    await expect(d.exec(`INSERT INTO public.owner_gate_signatures (job_id, gate, doc_key, doc_version, doc_draft, signed_text, signed_text_sha256, signatory_name, ticked, method) VALUES ('${JOB}','A','x','1',true,'t','s',' ',true,'login')`)).rejects.toThrow();
  });
  test("signed records are permanent; copy path can be filled once", async () => {
    const d = await db();
    await d.exec(ins());
    await d.exec(`UPDATE public.owner_gate_signatures SET copy_path='p.pdf'`);
    await expect(d.exec(`UPDATE public.owner_gate_signatures SET copy_path='other.pdf'`)).rejects.toThrow(/permanent/);
    await expect(d.exec(`UPDATE public.owner_gate_signatures SET signed_text='changed'`)).rejects.toThrow(/permanent/);
    await expect(d.exec(`DELETE FROM public.owner_gate_signatures`)).rejects.toThrow(/permanent/);
    await d.exec(`UPDATE public.owner_gate_signatures SET copy_email_queued=true`);
  });
  test("approvals are permanent and unique per version", async () => {
    const d = await db();
    await d.exec(`INSERT INTO public.owner_paperwork_approvals (doc_key, doc_version, body_sha256, approved_by) VALUES ('cooling_off_notice','v1','s',gen_random_uuid())`);
    await expect(d.exec(`INSERT INTO public.owner_paperwork_approvals (doc_key, doc_version, body_sha256, approved_by) VALUES ('cooling_off_notice','v1','s',gen_random_uuid())`)).rejects.toThrow();
    await expect(d.exec(`DELETE FROM public.owner_paperwork_approvals`)).rejects.toThrow(/permanent/);
  });
});
