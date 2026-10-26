// Practice database check for rls-initplan-speed.sql: every role sees exactly the same rows before and after,
// helpers are wrapped once, re-running changes nothing, undo restores the original rules. No network.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../docs/pending-migrations/${n}`, import.meta.url), "utf8");

const ADMIN = "00000000-0000-0000-0000-00000000000a";
const OWNER = "00000000-0000-0000-0000-00000000000b";
const OTHER = "00000000-0000-0000-0000-00000000000c";

async function setup() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    CREATE TYPE public.app_role AS ENUM ('admin','owner');
    CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
    CREATE FUNCTION public.has_role(_u uuid, _r public.app_role) RETURNS boolean LANGUAGE sql STABLE AS $$ select exists (select 1 from public.user_roles where user_id=_u and role=_r) $$;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ select public.has_role(auth.uid(), 'admin') $$;
    CREATE TABLE public.owners (id uuid primary key default gen_random_uuid(), user_id uuid);
    CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid(), owner_id uuid, property_id uuid, last_activity_at timestamptz default now());
    CREATE FUNCTION public.is_job_owner(_j uuid, _u uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ select exists (select 1 from public.jobs j join public.owners o on o.id=j.owner_id where j.id=_j and o.user_id=_u) $$;
    CREATE TABLE public.documents (id serial primary key, job_id uuid, internal boolean default false);
    CREATE TABLE public.templates (id serial primary key, created_by uuid, status text);
    CREATE TABLE public.appointment_proposals (id serial, job_id uuid, kind text, created_at timestamptz default now());
    CREATE TABLE public.contact_releases (id serial, job_id uuid);
    CREATE TABLE public.rectification_items (id serial, job_id uuid);
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY admin_all ON public.documents FOR ALL USING (is_admin()) WITH CHECK (is_admin());
    CREATE POLICY owner_read ON public.documents FOR SELECT USING (is_job_owner(job_id, auth.uid()) AND NOT internal);
    CREATE POLICY t_read ON public.templates FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role) OR created_by = auth.uid());
    CREATE POLICY t_ins ON public.templates FOR INSERT WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND created_by = auth.uid() AND status = 'draft');
    INSERT INTO public.user_roles VALUES ('${ADMIN}','admin');
    INSERT INTO public.owners (id, user_id) VALUES ('10000000-0000-0000-0000-000000000001','${OWNER}');
    INSERT INTO public.jobs (id, owner_id) VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002',null);
    INSERT INTO public.documents (job_id, internal) VALUES ('20000000-0000-0000-0000-000000000001',false),('20000000-0000-0000-0000-000000000001',true),('20000000-0000-0000-0000-000000000002',false);
    INSERT INTO public.templates (created_by, status) VALUES ('${OWNER}','draft'),('${OTHER}','draft');
    CREATE ROLE tester NOLOGIN; GRANT USAGE ON SCHEMA public, auth TO tester; GRANT SELECT ON ALL TABLES IN SCHEMA public TO tester; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO tester;
  `);
  return db;
}

async function seen(db: PGlite) {
  const out: Record<string, string> = {};
  for (const [name, uid] of [["admin", ADMIN], ["owner", OWNER], ["other", OTHER], ["none", ""]] as const) {
    await db.exec(`SET app.uid = '${uid}'; SET ROLE tester;`);
    const d = await db.query<{ id: number }>(`select id from public.documents order by id`);
    const t = await db.query<{ id: number }>(`select id from public.templates order by id`);
    await db.exec(`RESET ROLE;`);
    out[name] = `docs=${d.rows.map((r) => r.id).join(",")} templates=${t.rows.map((r) => r.id).join(",")}`;
  }
  return out;
}
const rules = async (db: PGlite) => (await db.query<{ policyname: string; qual: string | null; with_check: string | null }>(`select policyname, qual, with_check from pg_policies where schemaname='public' order by 1`)).rows;

test("RLS speed-up keeps every role's rows identical, re-runs safely and undoes cleanly", async () => {
  const db = await setup();
  const before = await seen(db);
  const original = await rules(db);
  await db.exec(read("rls-initplan-speed.sql"));
  const after1 = await rules(db);
  expect(await seen(db)).toEqual(before);
  expect(after1.find((r) => r.policyname === "admin_all")!.qual).toContain("SELECT is_admin()");
  expect(after1.find((r) => r.policyname === "owner_read")!.qual).toContain("SELECT auth.uid()");
  expect(after1.find((r) => r.policyname === "t_ins")!.with_check).toContain("SELECT has_role(");
  await db.exec(read("rls-initplan-speed.sql"));
  expect(await rules(db)).toEqual(after1);
  const idx = await db.query(`select 1 from pg_indexes where indexname in ('appointment_proposals_job_kind_created_idx','contact_releases_job_idx','jobs_property_id_idx','jobs_last_activity_idx','rectification_items_job_idx')`);
  expect(idx.rows.length).toBe(5);
  await db.exec(read("rls-initplan-speed.undo.sql"));
  expect(await rules(db)).toEqual(original);
  expect(await seen(db)).toEqual(before);
});
