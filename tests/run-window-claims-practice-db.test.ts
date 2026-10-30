import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { RUN_WINDOW_CLAIMED_EVENT, RUN_WINDOW_EVENTS, RUN_WINDOW_FREED_EVENT, currentClaim, runWindowFreedKey, runWindowKey, windowSlots } from "../src/lib/run-portal.core";

// Task 7 fix round 1: ONE claim per installer person + day + half-hour slot + generation (and one free per generation),
// across jobs, so two homes can never both take the same time; a freed slot is claimed again as the next generation.
// Fix round 2: a 1-hour window claims EVERY half-hour slot it covers (08:00 → 08:00 + 08:30), so 08:00 and 08:30 windows
// collide on the 08:30 slot.
// Fixture mirrors drizzle 0000 (job_id NOT NULL, append-only trigger).
const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const JOB = "11111111-1111-4111-8111-111111111111";
const JOB2 = "22222222-2222-4222-8222-222222222222";
async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid());
    CREATE TABLE public.workflow_events (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references public.jobs(id) on delete cascade,
      actor_id uuid, event_type text not null, summary text not null, details jsonb not null default '{}'::jsonb,
      internal boolean not null default false, created_at timestamptz not null default clock_timestamp());
    CREATE FUNCTION public.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events is append-only'; END $$;
    CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON public.workflow_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();
    INSERT INTO public.jobs (id) VALUES ('${JOB}'), ('${JOB2}');`);
  return db;
}
const W = { person: "u-sam", day: "2026-10-27", start: "09:00", slot: "09:00" };
const ins = (db: PGlite, job: string, type: string, gen: number, w: { start: string; slot: string } = W) =>
  db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, internal) VALUES ($1, $2, 's', $3::jsonb, true)`,
    [job, type, JSON.stringify({ run_id: "r1", seq: 1, person: W.person, day: W.day, ...w, gen, idempotency_key: type === RUN_WINDOW_CLAIMED_EVENT ? runWindowKey(W.person, W.day, w.slot, gen) : runWindowFreedKey(W.person, W.day, w.slot, gen) })]);
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "error");

test("the migration indexes exactly the two window events; no constraint change", () => {
  const sql = read("run-window-claims.sql");
  for (const t of RUN_WINDOW_EVENTS) expect(sql).toContain(`'${t}'`);
  expect(sql.replace(/^\s*--.*$/gm, "")).not.toMatch(/alter table|constraint/i);
});

test("before the migration a second claim is not refused (the server's check-first + earliest-row rule is the guard)", async () => {
  const db = await fixture();
  await ins(db, JOB, RUN_WINDOW_CLAIMED_EVENT, 1);
  expect(await code(ins(db, JOB2, RUN_WINDOW_CLAIMED_EVENT, 1))).toBeNull();
  const rows = await db.query<{ job_id: string; event_type: string; created_at: string; details: unknown }>(`SELECT job_id, event_type, created_at::text AS created_at, details FROM public.workflow_events ORDER BY created_at`);
  expect(currentClaim(rows.rows, W).claim?.jobId).toBe(JOB);
  await db.close();
});

test("after the migration (applied twice): one claim per window + generation across homes; freed → next generation; append-only", async () => {
  const db = await fixture();
  for (const f of ["run-window-claims.sql", "run-window-claims.sql"]) await db.exec(read(f));
  await ins(db, JOB, RUN_WINDOW_CLAIMED_EVENT, 1);
  expect(await code(ins(db, JOB2, RUN_WINDOW_CLAIMED_EVENT, 1))).toBe("23505");
  await ins(db, JOB, RUN_WINDOW_FREED_EVENT, 1);
  expect(await code(ins(db, JOB2, RUN_WINDOW_FREED_EVENT, 1))).toBe("23505");
  await ins(db, JOB2, RUN_WINDOW_CLAIMED_EVENT, 2);
  expect(await code(ins(db, JOB, RUN_WINDOW_CLAIMED_EVENT, 2))).toBe("23505");
  await db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details) VALUES ($1, 'stage_changed', 's', $2::jsonb), ($1, 'stage_changed', 's', $2::jsonb)`, [JOB, JSON.stringify({ idempotency_key: runWindowKey(W.person, W.day, W.slot, 2) })]);
  await expect(db.exec(`UPDATE public.workflow_events SET summary = 'x'`)).rejects.toThrow(/append-only/);
  const rows = await db.query<{ job_id: string; event_type: string; created_at: string; details: unknown }>(`SELECT job_id, event_type, created_at::text AS created_at, details FROM public.workflow_events WHERE event_type LIKE 'run_window%' ORDER BY created_at`);
  const st = currentClaim(rows.rows, W);
  expect({ gen: st.gen, job: st.claim?.jobId }).toEqual({ gen: 2, job: JOB2 });
  await db.close();
});

test("fix round 2: an 08:00 window and an 08:30 window of the same person collide on the 08:30 slot (one wins)", async () => {
  const db = await fixture();
  await db.exec(read("run-window-claims.sql"));
  expect(windowSlots("08:00", "09:00")).toEqual(["08:00", "08:30"]);
  expect(windowSlots("08:30", "09:30")).toEqual(["08:30", "09:00"]);
  for (const slot of windowSlots("08:00", "09:00")) await ins(db, JOB, RUN_WINDOW_CLAIMED_EVENT, 1, { start: "08:00", slot });
  const results = [];
  for (const slot of windowSlots("08:30", "09:30")) results.push(await code(ins(db, JOB2, RUN_WINDOW_CLAIMED_EVENT, 1, { start: "08:30", slot })));
  expect(results).toEqual(["23505", null]); // 08:30 taken; the server then frees the 09:00 it did get (all or nothing)
  await db.close();
});

test("rollback drops only the index; claims stay", async () => {
  const db = await fixture();
  await db.exec(read("run-window-claims.sql"));
  await ins(db, JOB, RUN_WINDOW_CLAIMED_EVENT, 1);
  await db.exec(read("run-window-claims.rollback.sql"));
  await db.exec(read("run-window-claims.rollback.sql"));
  const idx = await db.query<{ n: number }>(`SELECT count(*)::int n FROM pg_indexes WHERE indexname = 'workflow_events_run_window_once_idx'`);
  expect(idx.rows[0]!.n).toBe(0);
  expect(await code(ins(db, JOB2, RUN_WINDOW_CLAIMED_EVENT, 1))).toBeNull();
  await db.close();
});
