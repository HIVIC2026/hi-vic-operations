// Quarantine foundation only: no live migration, login or office capability is activated.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
const qa = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const tables = ["jobs", "owners", "businesses", "bookings", "invoices", "workflow_settings", "admin_config_events", "job_communications"];
async function as(user: string) { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${user}', false); SET ROLE authenticated;`); }
beforeAll(async () => {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public, auth TO authenticated, service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, service_role;
    CREATE TYPE public.app_role AS ENUM ('admin','owner','installer','electrician','property_manager');
    CREATE TABLE public.profiles(id uuid PRIMARY KEY, email text);
    CREATE TABLE public.user_roles(user_id uuid, role public.app_role);
    GRANT SELECT ON public.profiles,public.user_roles TO authenticated;
    ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY; ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
    CREATE POLICY self_profile ON public.profiles FOR SELECT TO authenticated USING (id=(SELECT auth.uid()));
    CREATE POLICY self_role ON public.user_roles FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role::text='admin') $$;
    INSERT INTO public.profiles VALUES ('${qa}','qa.office@hivic-test.example'),('${admin}','office@example.com');
    INSERT INTO public.user_roles VALUES ('${admin}','admin');`);
  for (const table of tables) await db.exec(`CREATE TABLE public.${table}(id integer PRIMARY KEY, source text, value text);
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.${table} TO authenticated;
    ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
    CREATE POLICY existing_read ON public.${table} FOR SELECT TO authenticated USING (true);
    CREATE POLICY admin_write ON public.${table} FOR ALL TO authenticated USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));
    INSERT INTO public.${table} VALUES (1,'base44','real'),(2,'qa_test','test');`);
  await db.exec(readFileSync("docs/pending-migrations/qa-office-foundation.sql", "utf8"));
  await db.exec(`INSERT INTO public.user_roles VALUES ('${qa}','qa_office');`);
});
afterAll(async () => { await db.close(); });
describe("qa_office quarantine on practice PostgreSQL; not live", () => {
  test("qa_office is not admin and real job by id is invisible", async () => {
    await as(qa);
    expect((await db.query<{ yes: boolean }>("SELECT public.is_admin() AS yes")).rows[0]?.yes).toBe(false);
    expect((await db.query("SELECT * FROM public.jobs WHERE id=1")).rows).toEqual([]);
  });
  for (const table of tables) test(`quarantine exposes zero real or TEST rows in ${table}`, async () => {
    await as(qa); expect((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows).toEqual([{ n: 0 }]);
  });
  test("settings and switch-equivalent writes affect no rows; inserts refused", async () => {
    await as(qa);
    expect((await db.query("UPDATE public.workflow_settings SET value='on' WHERE id=1 RETURNING id")).rows).toEqual([]);
    await expect(db.exec("INSERT INTO public.workflow_settings VALUES (3,'qa_test','on')")).rejects.toThrow();
  });
  test("admin retains all existing rows and write permissions", async () => {
    await as(admin);
    for (const table of tables) expect((await db.query(`SELECT count(*)::int AS n FROM public.${table}`)).rows).toEqual([{ n: 2 }]);
    expect((await db.query("UPDATE public.workflow_settings SET value='admin-updated' WHERE id=1 RETURNING value")).rows).toEqual([{ value: "admin-updated" }]);
  });
});