import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const SQL = readFileSync(new URL("../../docs/pending-migrations/0112_launch_campaign_responses.sql", import.meta.url), "utf8");

export const LAUNCH_ID = {
  admin: "00000000-0000-4000-8000-0000000000a1",
  job: "00000000-0000-4000-8000-0000000000b1",
  link: "00000000-0000-4000-8000-0000000000c1",
};

export async function launchCampaignDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TYPE public.app_role AS ENUM ('admin','electrician','installer','owner','property_manager');
    CREATE TABLE public.user_roles (id uuid primary key default gen_random_uuid(), user_id uuid not null, role public.app_role not null);
    CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid());
    CREATE TABLE public.customer_estimate_links (id uuid primary key default gen_random_uuid(), job_id uuid not null references public.jobs(id));
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT exists(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='admin') $$;
    GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid(), public.is_admin() TO authenticated, service_role;
    INSERT INTO public.user_roles(user_id, role) VALUES ('${LAUNCH_ID.admin}','admin');
    INSERT INTO public.jobs(id) VALUES ('${LAUNCH_ID.job}');
    INSERT INTO public.customer_estimate_links(id, job_id) VALUES ('${LAUNCH_ID.link}','${LAUNCH_ID.job}');
  `);
  await db.exec(SQL);
  return db;
}
