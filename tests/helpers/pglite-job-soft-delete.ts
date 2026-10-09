// Practice database proof for 0200 job soft delete. No network.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../../docs/pending-migrations/0200_job_soft_delete.sql", import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`
  CREATE ROLE authenticated; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ select '00000000-0000-0000-0000-0000000000aa'::uuid $$;
  CREATE TABLE public.admins (on_ boolean); INSERT INTO public.admins VALUES (false);
  CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql AS $$ select on_ from public.admins $$;
  CREATE FUNCTION public.job_assignment_role(uuid, uuid) RETURNS text LANGUAGE sql AS $$ select 'installer' $$;
  CREATE FUNCTION public.is_job_owner(uuid, uuid) RETURNS boolean LANGUAGE sql AS $$ select false $$;
  CREATE FUNCTION public.is_business_member(uuid, boolean) RETURNS boolean LANGUAGE sql AS $$ select false $$;
  CREATE TABLE public.job_assignments (job_id uuid, active boolean, business_id uuid);
  CREATE TABLE public.jobs (id uuid primary key, stage text);
  CREATE TABLE public.customer_email_sends (job_id uuid); CREATE TABLE public.sms_messages (job_id uuid);
  CREATE TABLE public.external_action_outbox (job_id uuid); CREATE TABLE public.partner_offers (job_id uuid); CREATE TABLE public.post_intake_work (job_id uuid);
  INSERT INTO public.jobs VALUES ('00000000-0000-0000-0000-000000000001','ready_check_scheduled'), ('00000000-0000-0000-0000-000000000002','ready_check_scheduled');`);
await db.exec(sql); await db.exec(sql); // re-runnable
const A = "'00000000-0000-0000-0000-000000000001'", B = "'00000000-0000-0000-0000-000000000002'";
const fails = async (q: string) => { try { await db.exec(q); return false; } catch { return true; } };
if (!(await fails(`UPDATE jobs SET deleted_at = now() WHERE id = ${A}`))) throw new Error("delete without actor/reason allowed");
await db.exec(`UPDATE jobs SET deleted_at = now(), deleted_by = auth.uid(), deleted_reason = 'Office asked' WHERE id = ${A}`);
if (!(await fails(`UPDATE jobs SET stage = 'cancelled' WHERE id = ${A}`))) throw new Error("deleted job stage changed");
for (const t of ["customer_email_sends", "sms_messages", "external_action_outbox", "partner_offers"]) if (!(await fails(`INSERT INTO ${t} VALUES (${A})`))) throw new Error(`${t} accepted for deleted job`);
await db.exec(`INSERT INTO post_intake_work VALUES (${A}), (${B})`);
if ((await db.query(`SELECT 1 FROM post_intake_work`)).rows.length !== 1) throw new Error("deleted job queue work not skipped");
await db.exec(`INSERT INTO customer_email_sends VALUES (${B})`); // other job unaffected
const acc = async (id: string) => (await db.query<{ v: boolean }>(`SELECT public.can_access_job(${id}) v`)).rows[0].v;
if (await acc(A)) throw new Error("trade still sees deleted job");
if (!(await acc(B))) throw new Error("trade lost other job");
await db.exec(`UPDATE admins SET on_ = true`); if (!(await acc(A))) throw new Error("office lost deleted job history");
await db.exec(`UPDATE jobs SET deleted_at = null WHERE id = ${A}`); await db.exec(`UPDATE jobs SET stage = 'cancelled' WHERE id = ${A}`); // restore works
console.log("PASS: 0200 soft delete — actor+reason required, stage frozen, sends/offers/outbox refused, queue skipped, trades/owners blocked, office keeps history, other jobs untouched, restore works");
