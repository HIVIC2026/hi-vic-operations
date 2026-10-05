// Throwaway in-memory PostgreSQL (PGlite) for migration 0106. Fake TEST data only.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (f: string) => readFileSync(new URL(`../../docs/pending-migrations/${f}`, import.meta.url), "utf8");
export const SQL = read("0106_installer_rate_requests.sql");
export const ROLLBACK = read("0106_installer_rate_requests.rollback.sql");
export const SQL107 = read("0107_installer_topup_rate.sql");
export const ROLLBACK107 = read("0107_installer_topup_rate.rollback.sql");
export const SQL110 = read("0110_installer_vacuum_only_rate.sql");
export const ROLLBACK110 = read("0110_installer_vacuum_only_rate.rollback.sql");
export const ID = { office: "00000000-0000-4000-8000-0000000000a1", inst: "00000000-0000-4000-8000-0000000000c1", other: "00000000-0000-4000-8000-0000000000c2", biz: "00000000-0000-4000-8000-0000000000d1", otherBiz: "00000000-0000-4000-8000-0000000000d2" };
export async function rateDb() {
  const db = new PGlite();
  await db.exec(`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
CREATE TABLE public.businesses (id uuid primary key, name text);
CREATE TABLE public.rate_cards (id uuid primary key default gen_random_uuid(), business_id uuid);
CREATE TABLE public.admins (user_id uuid primary key);
CREATE TABLE public.business_members (business_id uuid, user_id uuid);
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.admins WHERE user_id = auth.uid()) $$;
CREATE FUNCTION public.is_business_member(_biz uuid, _admin_only boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.business_members WHERE business_id=_biz AND user_id=auth.uid()) $$;
INSERT INTO public.businesses VALUES ('${ID.biz}','TEST A'),('${ID.otherBiz}','TEST B');
INSERT INTO public.admins VALUES ('${ID.office}');
INSERT INTO public.business_members VALUES ('${ID.biz}','${ID.inst}'),('${ID.otherBiz}','${ID.other}');
`);
  await db.exec(SQL);
  await db.exec(SQL107);
  await db.exec(SQL110);
  return db;
}
export const asUser = (db: PGlite, id: string) => db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${id}'`);
