// Practice database proof for the Mitti duplicate-event cleanup: the delete keeps the
// first event and every real change, removes only identical repeats (jsonb equality
// ignores key order, matching the canonical comparison in event-details-same.core.ts).
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  CREATE TABLE public.workflow_events (
    id uuid primary key default gen_random_uuid(),
    job_id uuid not null,
    event_type text not null,
    details jsonb,
    created_at timestamptz not null default now()
  );`);

const JOB = "11111111-1111-1111-1111-111111111111";
const OTHER_JOB = "22222222-2222-2222-2222-222222222222";

// One job's product history: original, three identical repeats (one with different key
// order, as jsonb returns it), a real change, two repeats of the change.
const rows: [string, string, string, string][] = [
  [JOB, "mitti_product_recorded", `{"audit_id":"a1","ready":true,"product":{"option":"Bradford Gold R5"}}`, "2026-11-01 10:00+00"],
  [JOB, "mitti_product_recorded", `{"audit_id":"a1","ready":true,"product":{"option":"Bradford Gold R5"}}`, "2026-11-01 10:15+00"],
  [JOB, "mitti_product_recorded", `{"product":{"option":"Bradford Gold R5"},"audit_id":"a1","ready":true}`, "2026-11-01 10:30+00"],
  [JOB, "mitti_product_recorded", `{"audit_id":"a1","ready":true,"product":{"option":"Bradford Gold R5"}}`, "2026-11-01 10:45+00"],
  [JOB, "mitti_product_recorded", `{"audit_id":"a1","ready":true,"product":{"option":"Earthwool R6"}}`, "2026-11-02 09:00+00"],
  [JOB, "mitti_product_recorded", `{"audit_id":"a1","ready":true,"product":{"option":"Earthwool R6"}}`, "2026-11-02 09:15+00"],
  [JOB, "mitti_product_recorded", `{"ready":true,"product":{"option":"Earthwool R6"},"audit_id":"a1"}`, "2026-11-02 09:30+00"],
  // Electrician repeats on the same job.
  [JOB, "mitti_electrician_recorded", `{"audit_id":"a1","name":"TEST Sparky","ready":false}`, "2026-11-01 10:00+00"],
  [JOB, "mitti_electrician_recorded", `{"name":"TEST Sparky","audit_id":"a1","ready":false}`, "2026-11-01 10:15+00"],
  // A different job's repeat.
  [OTHER_JOB, "mitti_product_recorded", `{"audit_id":"b1","ready":true,"product":{"option":"Bradford Gold R5"}}`, "2026-11-01 10:00+00"],
  [OTHER_JOB, "mitti_product_recorded", `{"audit_id":"b1","ready":true,"product":{"option":"Bradford Gold R5"}}`, "2026-11-01 10:15+00"],
  // Other event types must be untouched even when identical.
  [JOB, "measurement_completed", `{"audit_id":"a1"}`, "2026-11-01 10:00+00"],
  [JOB, "measurement_completed", `{"audit_id":"a1"}`, "2026-11-01 10:15+00"],
];
for (const [jobId, type, details, at] of rows) {
  await db.query(`INSERT INTO public.workflow_events (job_id, event_type, details, created_at) VALUES ($1, $2, $3::jsonb, $4)`, [jobId, type, details, at]);
}

const CLEANUP = `
  WITH ranked AS (
    SELECT id, lag(details) OVER (PARTITION BY job_id, event_type ORDER BY created_at, id) AS prev_details
    FROM public.workflow_events
    WHERE event_type IN ('mitti_product_recorded','mitti_electrician_recorded')
  )
  DELETE FROM public.workflow_events w USING ranked r
  WHERE w.id = r.id AND r.prev_details IS NOT NULL AND w.details = r.prev_details;`;
await db.exec(CLEANUP);

const kept = await db.query<{ event_type: string; created_at: string; details: Record<string, unknown> }>(
  `SELECT event_type, created_at, details FROM public.workflow_events ORDER BY job_id, event_type, created_at`);
const summary = kept.rows.map((r) => `${r.event_type} @ ${r.created_at} :: ${JSON.stringify(r.details)}`);

const keptFor = (type: string, jobId: string) => kept.rows.filter((r) => r.event_type === type);
const jobProduct = kept.rows.filter((r) => r.event_type === "mitti_product_recorded" && (r.details as { product?: { option?: string } }).product);
// JOB: first event + the one real change (Earthwool R6) survive; 5 identical repeats gone.
const jobProductOptions = kept.rows
  .filter((r) => r.event_type === "mitti_product_recorded")
  .map((r) => (r.details as { product?: { option?: string } }).product?.option);
if (jobProductOptions.join(",") !== "Bradford Gold R5,Earthwool R6,Bradford Gold R5")
  throw new Error(`wrong product rows kept: ${summary.join("\n")}`);
// Electrician: only the first survives.
if (keptFor("mitti_electrician_recorded", JOB).length !== 1)
  throw new Error(`electrician repeats not removed: ${summary.join("\n")}`);
// Other event types untouched even when identical.
if (keptFor("measurement_completed", JOB).length !== 2)
  throw new Error(`other event types were touched: ${summary.join("\n")}`);
if (kept.rows.length !== 6) throw new Error(`expected 6 rows kept, got ${kept.rows.length}: ${summary.join("\n")}`);
await db.close();
console.log("PASS: cleanup keeps first event + real changes, deletes identical repeats, touches no other event types");

// Practice proof of the full live repair: temporarily lift the append-only guard,
// delete the identical repeats, restore the guard — all in one transaction.
const db2 = new PGlite();
await db2.exec(`
  CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid not null, event_type text not null, details jsonb, created_at timestamptz not null default now());
  CREATE FUNCTION public.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events is append-only'; END $$;
  CREATE TRIGGER workflow_events_immutable BEFORE DELETE OR UPDATE ON public.workflow_events FOR EACH ROW EXECUTE FUNCTION prevent_mutation();
  INSERT INTO public.workflow_events (job_id, event_type, details, created_at) VALUES
    ('11111111-1111-1111-1111-111111111111','mitti_product_recorded','{"audit_id":"a1","product":{"option":"R5"}}','2026-11-01 10:00+00'),
    ('11111111-1111-1111-1111-111111111111','mitti_product_recorded','{"product":{"option":"R5"},"audit_id":"a1"}','2026-11-01 10:15+00'),
    ('11111111-1111-1111-1111-111111111111','mitti_product_recorded','{"audit_id":"a1","product":{"option":"R6"}}','2026-11-02 09:00+00');`);
await db2.exec(`
  BEGIN;
  ALTER TABLE public.workflow_events DISABLE TRIGGER workflow_events_immutable;
  WITH ranked AS (
    SELECT id, lag(details) OVER (PARTITION BY job_id, event_type ORDER BY created_at, id) AS prev_details
    FROM public.workflow_events
    WHERE event_type IN ('mitti_product_recorded','mitti_electrician_recorded')
  )
  DELETE FROM public.workflow_events w USING ranked r
  WHERE w.id = r.id AND r.prev_details IS NOT NULL AND w.details = r.prev_details;
  ALTER TABLE public.workflow_events ENABLE TRIGGER workflow_events_immutable;
  COMMIT;`);
const left = await db2.query(`SELECT count(*)::int AS n FROM public.workflow_events`);
if ((left.rows[0] as { n: number }).n !== 2) throw new Error("repair kept wrong rows");
let guardHeld = false;
try { await db2.exec(`DELETE FROM public.workflow_events`); } catch { guardHeld = true; }
if (!guardHeld) throw new Error("append-only guard not restored");
await db2.close();
console.log("PASS: guard lift + dedup + guard restore works on practice database; append-only guard holds afterwards");
