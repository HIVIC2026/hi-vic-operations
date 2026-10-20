// Practice database check for 0207: re-run safe, Outlook message stored once, review queue dedupe, rollback.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../../docs/pending-migrations/${n}`, import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.jobs (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.job_communications (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES jobs(id), provider text NOT NULL DEFAULT 'manual', provider_message_id text);`);
await db.exec(read("0207_outlook_correspondence.sql")); await db.exec(read("0207_outlook_correspondence.sql"));
const job = (await db.query<{ id: string }>(`INSERT INTO jobs DEFAULT VALUES RETURNING id`)).rows[0]!.id;
await db.query(`INSERT INTO job_communications (job_id, provider, provider_message_id) VALUES ($1,'outlook','m1')`, [job]);
let dup = false; try { await db.query(`INSERT INTO job_communications (job_id, provider, provider_message_id) VALUES ($1,'outlook','m1')`, [job]); } catch { dup = true; }
if (!dup) throw new Error("duplicate Outlook message accepted");
await db.query(`INSERT INTO job_communications (job_id, provider, provider_message_id) VALUES ($1,'manual',NULL),($1,'manual',NULL)`, [job]);
await db.exec(`INSERT INTO correspondence_reviews (kind, provider_message_id, direction, reason) VALUES ('unmatched','m2','inbound','two jobs')`);
const again = await db.query(`INSERT INTO correspondence_reviews (kind, provider_message_id, direction, reason) VALUES ('unmatched','m2','inbound','two jobs') ON CONFLICT DO NOTHING RETURNING id`);
if (again.rows.length) throw new Error("review duplicated");
if ((await db.query(`SELECT 1 FROM outlook_sync_state WHERE id=1`)).rows.length !== 1) throw new Error("state row");
await db.exec(read("0207_outlook_correspondence.rollback.sql"));
if ((await db.query(`SELECT 1 FROM pg_tables WHERE tablename IN ('correspondence_reviews','outlook_sync_state')`)).rows.length) throw new Error("rollback");
console.log("PASS: 0207 outlook correspondence — re-run safe, message stored once, review dedupe, rollback clean (practice database)");
