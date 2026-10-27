import { afterAll, beforeAll, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const db = new PGlite();
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const qa = id(1), admin = id(2), testJob = id(11), realJob = id(12), mixedJob = id(13);
const children = ["job_assignments", "partner_offers", "bookings", "assessments", "ceiling_measurements", "quotes", "invoices", "workflow_events", "documents", "evidence_files", "evidence_requirements", "job_communications", "office_snoozes"];
const globals = ["workflow_settings", "admin_config_events"];
const as = async (user: string) => db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub','${user}',false); SET ROLE authenticated;`);
beforeAll(async () => {
  await db.exec(`CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz);
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,service_role;
    CREATE TYPE public.app_role AS ENUM('admin','owner','installer','electrician','property_manager');
    CREATE TABLE public.user_roles(user_id uuid,role public.app_role);
    CREATE TABLE public.profiles(id uuid PRIMARY KEY,email text);
    CREATE TABLE public.owners(id uuid PRIMARY KEY,email text,user_id uuid);
    CREATE TABLE public.properties(id uuid PRIMARY KEY,owner_id uuid,managed_by_business_id uuid);
    CREATE TABLE public.businesses(id uuid PRIMARY KEY,email text,onboarding_notes text,signer_email text,contact_people jsonb);
    CREATE TABLE public.partner_workers(id uuid PRIMARY KEY,business_id uuid,profile_id uuid,email text);
    CREATE TABLE public.business_members(id uuid PRIMARY KEY,business_id uuid,user_id uuid);
    CREATE TABLE public.jobs(id uuid PRIMARY KEY,owner_id uuid,property_id uuid,source text,deleted_at timestamptz,qa_archived_at timestamptz,originating_installer_business_id uuid,originating_installer_user_id uuid);
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=(SELECT auth.uid()) AND role::text='admin') $$;
    INSERT INTO auth.users VALUES('${qa}','qa.office@hivic-test.example',now()),('${admin}','office@example.com',now());
    INSERT INTO public.profiles VALUES('${qa}','qa.office@hivic-test.example'),('${admin}','office@example.com');
    INSERT INTO public.user_roles VALUES('${admin}','admin');
    INSERT INTO public.owners VALUES('${id(21)}','owner@hivic-test.example',null),('${id(22)}','real@example.com',null);
    INSERT INTO public.properties VALUES('${id(31)}','${id(21)}',null),('${id(32)}','${id(22)}',null),('${id(33)}','${id(22)}',null);
    INSERT INTO public.businesses VALUES('${id(41)}','partner@hivic-test.example','[TEST PARTNER]',null,'[]'),('${id(42)}','real@example.com',null,null,'[]');
    INSERT INTO public.jobs VALUES('${testJob}','${id(21)}','${id(31)}','qa_test',null,null,'${id(41)}',null),('${realJob}','${id(22)}','${id(32)}','base44',null,null,'${id(42)}',null),('${mixedJob}','${id(22)}','${id(33)}','qa_test',null,null,null,null);`);
  for (const table of children) {
    const extras = table === "job_assignments" ? ",business_id uuid,user_id uuid" : table === "partner_offers" ? ",business_id uuid" : table === "bookings" ? ",business_id uuid,contractor_id uuid" : table === "assessments" ? ",assessor_id uuid" : table === "ceiling_measurements" ? ",completed_by uuid,measured_by_business_id uuid" : "";
    await db.exec(`CREATE TABLE public.${table}(id uuid PRIMARY KEY,job_id uuid${extras}); INSERT INTO public.${table}(id,job_id) VALUES('${id(51)}','${testJob}'),('${id(52)}','${realJob}'),('${id(53)}','${mixedJob}');`);
  }
  await db.exec(`UPDATE public.partner_offers SET business_id='${id(41)}' WHERE job_id='${testJob}'; UPDATE public.partner_offers SET business_id='${id(42)}' WHERE job_id='${realJob}';
    CREATE TABLE public.quote_items(id uuid PRIMARY KEY,quote_id uuid); CREATE TABLE public.quote_internals(id uuid PRIMARY KEY,quote_id uuid);
    INSERT INTO public.quote_items VALUES('${id(61)}','${id(51)}'),('${id(62)}','${id(52)}'); INSERT INTO public.quote_internals SELECT * FROM public.quote_items;`);
  for (const table of globals) await db.exec(`CREATE TABLE public.${table}(id uuid PRIMARY KEY,value text); INSERT INTO public.${table} VALUES('${id(71)}','off');`);
  for (const table of ["profiles", "user_roles", "owners", "properties", "businesses", "partner_workers", "business_members", "jobs", ...children, "quote_items", "quote_internals", ...globals]) {
    await db.exec(`GRANT SELECT,INSERT,UPDATE,DELETE ON public.${table} TO authenticated; GRANT ALL ON public.${table} TO service_role; ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;
      CREATE POLICY existing_read ON public.${table} FOR SELECT TO authenticated USING(true);
      CREATE POLICY existing_admin ON public.${table} FOR ALL TO authenticated USING((SELECT is_admin())) WITH CHECK((SELECT is_admin()));`);
  }
  await db.exec(readFileSync("docs/pending-migrations/qa-office-foundation.sql", "utf8"));
  await db.exec(`INSERT INTO public.user_roles VALUES('${qa}','qa_office');`);
  await db.exec(readFileSync("docs/pending-migrations/qa-office-job-scope.sql", "utf8"));
});
afterAll(async () => db.close());
test("job capability refuses real and real-owner-linked TEST jobs", async () => {
  await as(qa);
  for (const [job, allowed] of [[testJob, true], [realJob, false], [mixedJob, false]] as const) expect((await db.query<{ allowed: boolean }>(`SELECT public.qa_office_job_allowed('${job}') AS allowed`)).rows).toEqual([{ allowed }]);
});
for (const table of ["jobs", ...children]) test(`${table}: TEST-only list and real-id refusal; admin unchanged`, async () => {
  await as(qa);
  expect((await db.query(`SELECT id FROM public.${table} ORDER BY id`)).rows).toEqual([{ id: table === "jobs" ? testJob : id(51) }]);
  expect((await db.query(`SELECT * FROM public.${table} WHERE id='${table === "jobs" ? realJob : id(52)}'`)).rows).toEqual([]);
  await as(admin); expect((await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows).toEqual([{ n: 3 }]);
});
for (const table of ["owners", "properties", "businesses", "quote_items", "quote_internals"]) test(`${table}: related real rows hidden; admin unchanged`, async () => {
  await as(qa); expect((await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows).toEqual([{ n: 1 }]);
  await as(admin); expect((await db.query(`SELECT count(*)::int n FROM public.${table}`)).rows[0]?.n).toBe(table === "properties" ? 3 : 2);
});
for (const table of globals) test(`${table}: no settings reads or switch writes; admin unchanged`, async () => {
  await as(qa); expect((await db.query(`SELECT * FROM public.${table}`)).rows).toEqual([]);
  expect((await db.query(`UPDATE public.${table} SET value='on' RETURNING id`)).rows).toEqual([]);
  await expect(db.exec(`INSERT INTO public.${table} VALUES('${id(72)}','on')`)).rejects.toThrow();
  await as(admin); expect((await db.query(`UPDATE public.${table} SET value='admin' RETURNING id`)).rows).toEqual([{ id: id(71) }]);
});
test("mixed roles and unverified email fail closed", async () => {
  await db.exec(`RESET ROLE; UPDATE auth.users SET email_confirmed_at=null WHERE id='${qa}';`);
  await as(qa); expect((await db.query("SELECT public.is_qa_office() allowed")).rows).toEqual([{ allowed: false }]);
  await db.exec(`RESET ROLE; UPDATE auth.users SET email_confirmed_at=now() WHERE id='${qa}'; INSERT INTO public.user_roles VALUES('${qa}','owner');`);
  await as(qa); expect((await db.query("SELECT public.is_qa_office() allowed")).rows).toEqual([{ allowed: false }]);
  await db.exec(`RESET ROLE; DELETE FROM public.user_roles WHERE user_id='${qa}' AND role::text='owner';`);
});
test("linking a TEST business to a real job revokes the entire TEST graph", async () => {
  await db.exec(`RESET ROLE; UPDATE public.jobs SET originating_installer_business_id='${id(41)}' WHERE id='${realJob}';`);
  await as(qa); expect((await db.query("SELECT * FROM public.jobs")).rows).toEqual([]);
  await db.exec(`RESET ROLE; UPDATE public.jobs SET originating_installer_business_id='${id(42)}' WHERE id='${realJob}';`);
});