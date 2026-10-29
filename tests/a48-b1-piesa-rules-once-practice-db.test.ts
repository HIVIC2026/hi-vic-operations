// A48 batch 1 final fix on PGlite (throwaway in-memory Postgres, fake rows only): pending migration piesa-rules-once.sql
// lets ONE `piesa_rules_failed` event per notice_key in; rows without a key and other event types are untouched; undo drops it.
import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const JOB = "00000000-0000-4000-8000-0000000a4801";
const KEY = `piesa-rules:v1:${JOB}:aud-1:2026-10-29T01:00:00.000Z`;

async function fresh() {
  const db = new PGlite();
  await db.exec(`CREATE TABLE public.workflow_events (id uuid primary key default gen_random_uuid(), job_id uuid, actor_id uuid, event_type text not null, summary text not null,
    details jsonb not null default '{}'::jsonb, internal boolean not null default false, created_at timestamptz not null default clock_timestamp());`);
  return db;
}
const ins = (db: PGlite, type: string, details: Record<string, unknown>) =>
  db.query(`INSERT INTO workflow_events (job_id, event_type, summary, details) VALUES ($1, $2, 'x', $3::jsonb)`, [JOB, type, JSON.stringify(details)]);

describe("piesa-rules-once.sql (practice database)", () => {
  test("a second failure event with the same notice_key is refused (23505)", async () => {
    const db = await fresh();
    await ins(db, "piesa_rules_failed", { notice_key: KEY });
    await db.exec(read("piesa-rules-once.sql"));
    await db.exec(read("piesa-rules-once.sql")); // idempotent
    const err = await ins(db, "piesa_rules_failed", { notice_key: KEY }).then(() => null, (e: { code?: string }) => e);
    expect(err?.code).toBe("23505");
  });
  test("rows without a key, other keys and other event types still go in; builds over existing history", async () => {
    const db = await fresh();
    await ins(db, "piesa_rules_failed", { form_version: "a" });
    await ins(db, "piesa_rules_failed", { form_version: "a" });
    await db.exec(read("piesa-rules-once.sql"));
    await ins(db, "piesa_rules_failed", { form_version: "a" });
    await ins(db, "piesa_rules_failed", { notice_key: KEY });
    await ins(db, "piesa_rules_failed", { notice_key: `${KEY}-2` });
    await ins(db, "piesa_rules_cleared", { notice_key: KEY });
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM workflow_events")).rows[0]!.n).toBe(6);
  });
  test("undo drops only the index", async () => {
    const db = await fresh();
    await db.exec(read("piesa-rules-once.sql"));
    await db.exec(read("piesa-rules-once.undo.sql"));
    await ins(db, "piesa_rules_failed", { notice_key: KEY });
    await ins(db, "piesa_rules_failed", { notice_key: KEY });
    expect((await db.query<{ n: number }>("SELECT count(*)::int AS n FROM workflow_events")).rows[0]!.n).toBe(2);
  });
});
