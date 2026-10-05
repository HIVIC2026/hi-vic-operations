// Throwaway in-process PostgreSQL (PGlite) for the bulk import tables. No network, no URL:
// the database lives only in this test process's memory and disappears when it ends.
// Every row inserted is fake TEST data.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (f: string) =>
  readFileSync(new URL(`../../docs/pending-migrations/${f}`, import.meta.url), "utf8");
export const BULK_SQL = read("0104_bulk_import.sql") + "\n" + read("0105_bulk_import_sort_labels.sql") + "\n" + read("0118_bulk_import_review_plan.sql");
export const BULK_ROLLBACK_SQL = read("0118_bulk_import_review_plan.rollback.sql") + "\n" + read("0104_bulk_import.rollback.sql");

const BASE = `
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
CREATE TYPE public.app_role AS ENUM ('admin','electrician','installer','owner','property_manager');
CREATE TABLE public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null, unique(user_id, role));
CREATE TABLE public.businesses (id uuid primary key default gen_random_uuid(), name text);
CREATE TABLE public.business_members (id uuid primary key default gen_random_uuid(), business_id uuid not null references public.businesses(id), user_id uuid not null, role text default 'member');
CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid(), job_number text);
GRANT ALL ON public.jobs, public.businesses, public.user_roles, public.business_members TO authenticated;
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.user_roles WHERE user_id=_user_id AND role=_role) $$;
CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT public.has_role(auth.uid(), 'admin') $$;
CREATE FUNCTION public.is_business_member(_biz uuid, _admin_only boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.business_members WHERE business_id=_biz AND user_id=auth.uid()) $$;
`;

export const ID = {
  office: "00000000-0000-4000-8000-0000000000a1",
  installer: "00000000-0000-4000-8000-0000000000c1",
  otherInstaller: "00000000-0000-4000-8000-0000000000c2",
  biz: "00000000-0000-4000-8000-0000000000d1",
  otherBiz: "00000000-0000-4000-8000-0000000000d2",
};

export async function bulkDb() {
  const db = new PGlite();
  await db.exec(BASE);
  await db.exec(`
    INSERT INTO public.user_roles(user_id, role) VALUES ('${ID.office}','admin'),('${ID.installer}','installer'),('${ID.otherInstaller}','installer');
    INSERT INTO public.businesses(id, name) VALUES ('${ID.biz}','TEST ReInsulate'),('${ID.otherBiz}','TEST Other');
    INSERT INTO public.business_members(business_id, user_id) VALUES ('${ID.biz}','${ID.installer}'),('${ID.otherBiz}','${ID.otherInstaller}');
  `);
  await db.exec(BULK_SQL);
  return db;
}

export async function asUser(db: PGlite, userId: string) {
  // postgres bypasses RLS; switch to the authenticated role so policies are exercised
  await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub = '${userId}'`);
}
