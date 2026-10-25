import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import {
  SPOT_RELEASED_EVENT, SPOT_RELEASE_CONFIRMED_EVENT, SPOT_RELEASE_DECLINED_EVENT, SPOT_RELEASE_EVENTS, SPOT_RELEASE_LAPSED_EVENT, SPOT_RELEASE_REMINDED_EVENT,
  spotReleaseKey, spotReleaseState, type SpotReleaseEventRow,
} from "../src/lib/spot-release.core";

// Decision 389: ONE claim per job + release + slot (unique idempotency key over the five spot-release event types), so two
// presses of Release never both send, and confirm / decline / lapse (the shared "outcome" slot) never both win. Other
// events are unaffected; the log stays append-only; idempotent; rollback drops only its two indexes.
// Fixture mirrors drizzle 0000 (job_id NOT NULL, append-only trigger).
const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const JOB = "11111111-1111-4111-8111-111111111111";
const JOB2 = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE public.job_stage AS ENUM ('new_enquiry','ready_check_ready_to_schedule','cancelled');
    CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid());
    CREATE TABLE public.workflow_events (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references public.jobs(id) on delete cascade,
      actor_id uuid, event_type text not null, from_stage public.job_stage, to_stage public.job_stage,
      summary text not null, details jsonb not null default '{}'::jsonb, internal boolean not null default false,
      created_at timestamptz not null default now());
    CREATE FUNCTION public.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events is append-only'; END $$;
    CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON public.workflow_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();
    INSERT INTO public.jobs (id) VALUES ('${JOB}'), ('${JOB2}');`);
  return db;
}
const ins = (db: PGlite, job: string, type: string, details: Record<string, unknown>) =>
  db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, internal) VALUES ($1, $2, 's', $3::jsonb, true)`, [job, type, JSON.stringify(details)]);
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "error");
const rel = (job: string, seq: number) => ({ release_seq: seq, business_id: "b1", business_name: "Sample Insulation", idempotency_key: spotReleaseKey(job, seq, "released") });
const out = (job: string, seq: number) => ({ release_seq: seq, idempotency_key: spotReleaseKey(job, seq, "outcome") });

test("the event names and keys are the ones the migration indexes; no constraint change", () => {
  const sql = read("spot-release-events.sql");
  for (const t of SPOT_RELEASE_EVENTS) expect(sql).toContain(`'${t}'`);
  expect(spotReleaseKey(JOB, 2, "outcome")).toBe(`spot-release:v1:${JOB}:2:outcome`);
  expect(sql.replace(/^\s*--.*$/gm, "")).not.toMatch(/alter table|constraint/i);
});

test("before the migration a second claim is NOT refused (the server's read-then-insert check is the only guard)", async () => {
  const db = await fixture();
  await ins(db, JOB, SPOT_RELEASED_EVENT, rel(JOB, 1));
  expect(await code(ins(db, JOB, SPOT_RELEASED_EVENT, rel(JOB, 1)))).toBeNull();
  await db.close();
});

test("after the migration (applied twice): one claim per slot; outcome is shared; other events free; append-only", async () => {
  const db = await fixture();
  for (const f of ["spot-release-events.sql", "owner-email-auto-reply-events.sql", "spot-release-events.sql"]) await db.exec(read(f));
  await ins(db, JOB, SPOT_RELEASED_EVENT, rel(JOB, 1));
  // Two presses of Release for the same release number: the second is refused → nothing sent twice.
  expect(await code(ins(db, JOB, SPOT_RELEASED_EVENT, rel(JOB, 1)))).toBe("23505");
  // Day-2 reminder once.
  await ins(db, JOB, SPOT_RELEASE_REMINDED_EVENT, { release_seq: 1, step: "reminder", idempotency_key: spotReleaseKey(JOB, 1, "reminder") });
  expect(await code(ins(db, JOB, SPOT_RELEASE_REMINDED_EVENT, { release_seq: 1, step: "reminder", idempotency_key: spotReleaseKey(JOB, 1, "reminder") }))).toBe("23505");
  // Confirm wins the outcome; a racing decline or the lapse for the same release are refused.
  await ins(db, JOB, SPOT_RELEASE_CONFIRMED_EVENT, out(JOB, 1));
  expect(await code(ins(db, JOB, SPOT_RELEASE_DECLINED_EVENT, out(JOB, 1)))).toBe("23505");
  expect(await code(ins(db, JOB, SPOT_RELEASE_LAPSED_EVENT, out(JOB, 1)))).toBe("23505");
  expect(await code(ins(db, JOB, SPOT_RELEASE_CONFIRMED_EVENT, out(JOB, 1)))).toBe("23505");
  // Another job, and a new release number on a lapsed job, are their own claims.
  await ins(db, JOB2, SPOT_RELEASED_EVENT, rel(JOB2, 1));
  await ins(db, JOB2, SPOT_RELEASE_LAPSED_EVENT, out(JOB2, 1));
  await ins(db, JOB2, SPOT_RELEASED_EVENT, rel(JOB2, 2));
  // Unrelated events (e.g. the stage change at decline, offer events) are untouched by the index.
  await ins(db, JOB, "stage_changed", { idempotency_key: spotReleaseKey(JOB, 1, "outcome") });
  await ins(db, JOB, "stage_changed", { idempotency_key: spotReleaseKey(JOB, 1, "outcome") });
  await expect(db.exec(`UPDATE public.workflow_events SET summary = 'x'`)).rejects.toThrow(/append-only/);
  // The state the server reads back from these rows.
  const rows = await db.query<SpotReleaseEventRow & { job_id: string }>(`SELECT job_id, event_type, created_at::text AS created_at, details FROM public.workflow_events WHERE event_type LIKE 'spot_release%' ORDER BY created_at`);
  expect(spotReleaseState(rows.rows.filter((r) => r.job_id === JOB)).state).toBe("confirmed");
  const j2 = spotReleaseState(rows.rows.filter((r) => r.job_id === JOB2));
  expect({ state: j2.state, seq: j2.state === "none" ? 0 : j2.seq }).toEqual({ state: "pending", seq: 2 });
  await db.close();
});

test("rollback drops only the two indexes; claims written stay", async () => {
  const db = await fixture();
  await db.exec(read("spot-release-events.sql"));
  await ins(db, JOB, SPOT_RELEASED_EVENT, rel(JOB, 1));
  await db.exec(read("spot-release-events.rollback.sql"));
  await db.exec(read("spot-release-events.rollback.sql"));
  const idx = await db.query<{ n: number }>(`SELECT count(*)::int n FROM pg_indexes WHERE indexname LIKE 'workflow_events_spot_release%'`);
  expect(idx.rows[0]!.n).toBe(0);
  expect(await code(ins(db, JOB, SPOT_RELEASED_EVENT, rel(JOB, 1)))).toBeNull();
  const n = await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.workflow_events`);
  expect(n.rows[0]!.n).toBe(2);
  await db.close();
});
