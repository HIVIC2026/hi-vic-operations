// Practice database proof for 0201: queued rows of deleted jobs cannot be claimed/retried; bookings refused. No network.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const sql = readFileSync(new URL("../../docs/pending-migrations/0201_job_soft_delete_claims.sql", import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`
  CREATE TABLE public.jobs (id uuid primary key, deleted_at timestamptz);
  CREATE FUNCTION public.block_deleted_job_child() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF EXISTS (SELECT 1 FROM public.jobs j WHERE j.id = NEW.job_id AND j.deleted_at IS NOT NULL) THEN RAISE EXCEPTION 'deleted'; END IF; RETURN NEW; END $$;
  CREATE TABLE public.customer_email_sends (id int, job_id uuid, status text);
  CREATE TABLE public.sms_messages (id int, job_id uuid, status text);
  CREATE TABLE public.external_action_outbox (id int, job_id uuid, status text);
  CREATE TABLE public.bookings (id int, job_id uuid, status text);
  INSERT INTO jobs VALUES ('00000000-0000-0000-0000-000000000001', null), ('00000000-0000-0000-0000-000000000002', null);`);
const A = "'00000000-0000-0000-0000-000000000001'", B = "'00000000-0000-0000-0000-000000000002'";
for (const t of ["customer_email_sends", "sms_messages", "external_action_outbox"]) await db.exec(`INSERT INTO ${t} VALUES (1, ${A}, 'failed'), (2, ${A}, 'sending'), (3, ${B}, 'failed')`);
await db.exec(`INSERT INTO bookings VALUES (1, ${A}, 'cancelled'), (2, ${B}, 'cancelled')`);
await db.exec(sql); await db.exec(sql);
await db.exec(`UPDATE jobs SET deleted_at = now() WHERE id = ${A}`);
const fails = async (q: string) => { try { await db.exec(q); return false; } catch { return true; } };
for (const t of ["customer_email_sends", "sms_messages", "external_action_outbox"]) {
  if (!(await fails(`UPDATE ${t} SET status = 'sending' WHERE id = 1`))) throw new Error(`${t}: retry claim allowed for deleted job`);
  if (await fails(`UPDATE ${t} SET status = 'sent' WHERE id = 2`)) throw new Error(`${t}: provider outcome for already-handed-over row refused`);
  if (await fails(`UPDATE ${t} SET status = 'sending' WHERE id = 3`)) throw new Error(`${t}: other job blocked`);
}
if (!(await fails(`UPDATE bookings SET status = 'confirmed' WHERE id = 1`))) throw new Error("cancelled booking revived for deleted job");
if (!(await fails(`INSERT INTO bookings VALUES (9, ${A}, 'confirmed')`))) throw new Error("new booking for deleted job");
if (await fails(`UPDATE bookings SET status = 'confirmed' WHERE id = 2`)) throw new Error("other job booking blocked");
await db.exec(`UPDATE jobs SET deleted_at = null WHERE id = ${A}`);
if (await fails(`UPDATE customer_email_sends SET status = 'sending' WHERE id = 1`)) throw new Error("restore did not reopen sends");
console.log("PASS: 0201 — queued/retry claims and bookings refused for deleted jobs; provider outcomes recorded; other jobs and restore unaffected");
