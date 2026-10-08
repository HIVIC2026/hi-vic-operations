// Practice database check for 0147: intake_media_reviewed accepted, other types still allowed, undo restores the list.
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
const read = (n: string) => readFileSync(new URL(`../../docs/pending-migrations/${n}`, import.meta.url), "utf8");
const db = new PGlite();
await db.exec(`CREATE TABLE public.customer_engagement_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid, estimate_link_id uuid, event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(), source text, metadata jsonb, dedupe_key text, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_engagement_events_event_type_check CHECK (event_type = ANY (ARRAY['email_sent','email_delivered','email_opened','email_clicked','estimate_viewed','calculator_used','booking_started','booking_completed','followup_queued','followup_sent','followup_suppressed','email_bounced','email_failed'])));`);
const ins = (t: string) => db.query(`INSERT INTO public.customer_engagement_events (event_type, metadata) VALUES ($1, '{"outcome":"unclear"}')`, [t]);
let threw = false;
try { await ins("intake_media_reviewed"); } catch { threw = true; }
if (!threw) throw new Error("new type accepted before migration");
await db.exec(read("0147_intake_media_reviewed.sql")); await db.exec(read("0147_intake_media_reviewed.sql"));
await ins("intake_media_reviewed"); await ins("email_sent");
threw = false;
try { await ins("made_up_type"); } catch { threw = true; }
if (!threw) throw new Error("unknown type still accepted");
await db.query(`DELETE FROM public.customer_engagement_events WHERE event_type = 'intake_media_reviewed'`);
await db.exec(read("0147_intake_media_reviewed.undo.sql"));
threw = false;
try { await ins("intake_media_reviewed"); } catch { threw = true; }
if (!threw) throw new Error("undo did not remove the type");
console.log("PASS: 0147 intake_media_reviewed — accepted after migration, unknown types rejected, undo clean (practice database)");
