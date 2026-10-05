// Practice database (PGlite) proof for migration 0108. Fake TEST data only.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../docs/pending-migrations/${f}`, import.meta.url), "utf8");
const SQL = read("0108_owner_eligibility_links.sql");
const ROLLBACK = read("0108_owner_eligibility_links.rollback.sql");
const ID = { office: "00000000-0000-4000-8000-0000000000a1", inst: "00000000-0000-4000-8000-0000000000c1", other: "00000000-0000-4000-8000-0000000000c2", biz: "00000000-0000-4000-8000-0000000000d1", otherBiz: "00000000-0000-4000-8000-0000000000d2", job: "00000000-0000-4000-8000-0000000000e1" };

async function db() {
  const d = new PGlite();
  await d.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE public.businesses (id uuid primary key, name text);
CREATE TABLE public.jobs (id uuid primary key, job_number text);
CREATE TABLE public.admins (user_id uuid primary key);
CREATE TABLE public.business_members (business_id uuid, user_id uuid);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.admins WHERE user_id = auth.uid()) $$;
CREATE FUNCTION public.is_business_member(_biz uuid, _admin_only boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.business_members WHERE business_id=_biz AND user_id=auth.uid()) $$;
INSERT INTO public.businesses VALUES ('${ID.biz}','TEST A'),('${ID.otherBiz}','TEST B');
INSERT INTO public.jobs VALUES ('${ID.job}','HV-TEST');
INSERT INTO public.admins VALUES ('${ID.office}');
INSERT INTO public.business_members VALUES ('${ID.biz}','${ID.inst}'),('${ID.otherBiz}','${ID.other}');`);
  await d.exec(SQL);
  await d.exec(`INSERT INTO public.owner_eligibility_links (job_id, business_id, token_hash, expires_at) VALUES ('${ID.job}','${ID.biz}','h1', now() + interval '30 days')`);
  return d;
}
const as = (d: PGlite, id: string) => d.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${id}'`);

describe("0108 owner eligibility links (practice database)", () => {
  test("installer company sees only its own links", async () => {
    const d = await db();
    await as(d, ID.inst); expect((await d.query("select id from public.owner_eligibility_links")).rows.length).toBe(1);
    await as(d, ID.other); expect((await d.query("select id from public.owner_eligibility_links")).rows.length).toBe(0);
  });
  test("signed-in users cannot write; only the server can", async () => {
    const d = await db();
    await as(d, ID.inst);
    await expect(d.exec(`UPDATE public.owner_eligibility_links SET revoked_at = now()`)).rejects.toThrow();
    await as(d, ID.office);
    await expect(d.exec(`UPDATE public.owner_eligibility_links SET revoked_at = now()`)).rejects.toThrow();
    await d.exec("RESET ROLE; SET ROLE service_role");
    const r = await d.query(`UPDATE public.owner_eligibility_links SET revoked_at = now() RETURNING id`);
    expect(r.rows.length).toBe(1);
  });
  test("result must be one of the three outcomes and go with submitted time", async () => {
    const d = await db();
    await expect(d.exec(`UPDATE public.owner_eligibility_links SET result='review_required', submitted_at=now()`)).rejects.toThrow();
    await expect(d.exec(`UPDATE public.owner_eligibility_links SET result='likely_eligible'`)).rejects.toThrow();
    await d.exec(`UPDATE public.owner_eligibility_links SET result='likely_eligible', submitted_at=now()`);
  });
  test("token hash is unique", async () => {
    const d = await db();
    await expect(d.exec(`INSERT INTO public.owner_eligibility_links (job_id, token_hash, expires_at) VALUES ('${ID.job}','h1', now())`)).rejects.toThrow();
  });
  test("undo removes only the new table", async () => {
    const d = await db();
    await d.exec(ROLLBACK);
    expect((await d.query(`select to_regclass('public.owner_eligibility_links') t`)).rows[0]).toEqual({ t: null });
    expect((await d.query(`select count(*)::int n from public.jobs`)).rows[0]).toEqual({ n: 1 });
  });
});
