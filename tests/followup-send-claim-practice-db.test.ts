// Follow-up replies through Outlook (Jo 28 Oct 2026): the once-only claim (`email_nojob_followup_claim`, unique on
// details->>'claim_key') and the job-less failure record (`email_nojob_followup_failed`). The migration widens
// `workflow_events_job_required` from the latest definition (emails-tab-nojob-events.sql, applied live 27 Oct 2026)
// without dropping any type; the rollback puts that definition back. Fixture mirrors drizzle 0000, then the earlier
// pending migrations in order.
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { NO_JOB_FOLLOWUP_CLAIM_EVENT, noJobFollowUpSentKey } from "../src/lib/emails-tab.core";

const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const JOB = "11111111-1111-4111-8111-111111111111";
const FAILED = "email_nojob_followup_failed";
const PREVIOUS = ["email_unmatched", "email_unmatched_dismissed", "email_new_sender_replied", "email_nojob_ai_draft", "email_nojob_reply_sent", "email_nojob_ai_draft_closed"];

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TYPE public.job_stage AS ENUM ('new_enquiry','cancelled');
    CREATE TABLE public.jobs (id uuid primary key default gen_random_uuid());
    CREATE TABLE public.workflow_events (
      id uuid primary key default gen_random_uuid(),
      job_id uuid not null references public.jobs(id) on delete cascade,
      actor_id uuid, event_type text not null, from_stage public.job_stage, to_stage public.job_stage,
      summary text not null, details jsonb not null default '{}'::jsonb, internal boolean not null default false,
      created_at timestamptz not null default now());
    CREATE FUNCTION public.prevent_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'workflow_events is append-only'; END $$;
    CREATE TRIGGER workflow_events_immutable BEFORE UPDATE OR DELETE ON public.workflow_events FOR EACH ROW EXECUTE FUNCTION public.prevent_mutation();
    INSERT INTO public.jobs (id) VALUES ('${JOB}');`);
  for (const f of ["email-unmatched-events.sql", "new-sender-reply-events.sql", "emails-tab-nojob-events.sql"]) await db.exec(read(f));
  return db;
}
const ins = (db: PGlite, job: string | null, type: string, details: Record<string, unknown> = {}) =>
  db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, internal) VALUES ($1, $2, 's', $3::jsonb, true)`, [job, type, JSON.stringify(details)]);
const claim = (mid: string, tries: number) => ({ message_id: mid, claim_key: `${noJobFollowUpSentKey(mid)}:try${tries}` });
const constraintDef = async (db: PGlite) =>
  (await db.query<{ d: string }>(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname = 'workflow_events_job_required'`)).rows[0]!.d;

test("the migration names the claim event, the failure event and the claim key index", () => {
  expect(NO_JOB_FOLLOWUP_CLAIM_EVENT).toBe("email_nojob_followup_claim");
  const sql = read("followup-send-claim.sql");
  expect(sql).toContain(`'${NO_JOB_FOLLOWUP_CLAIM_EVENT}'`);
  expect(sql).toContain(`'${FAILED}'`);
  expect(sql).toContain("details->>'claim_key'");
});

test("before the migration the job-less claim and failure rows are refused", async () => {
  const db = await fixture();
  await expect(ins(db, null, NO_JOB_FOLLOWUP_CLAIM_EVENT, claim("m1", 0))).rejects.toThrow(/workflow_events_job_required/);
  await expect(ins(db, null, FAILED, { message_id: "m1" })).rejects.toThrow(/workflow_events_job_required/);
  await db.close();
});

test("after (run twice): claim and failure rows may have no job; every earlier type still allowed; others keep their job; one claim per key; append-only", async () => {
  const db = await fixture();
  await db.exec(read("followup-send-claim.sql"));
  await db.exec(read("followup-send-claim.sql"));
  await ins(db, null, NO_JOB_FOLLOWUP_CLAIM_EVENT, claim("m1", 0));
  await ins(db, null, FAILED, { message_id: "m1", status: "failed: nope" });
  for (const t of PREVIOUS) await ins(db, null, t, { from: `${t}@example.org`, mode: "test", idempotency_key: t });
  await ins(db, JOB, "email_change_request");
  await expect(ins(db, null, "email_change_request")).rejects.toThrow(/workflow_events_job_required/);
  await expect(ins(db, null, "email_nojob_ai_draft_failed_typo")).rejects.toThrow(/workflow_events_job_required/);
  // The once-only claim: the same key again is refused with 23505; the next try (after a definite failure) and another
  // email's key are fine.
  const dup = await ins(db, null, NO_JOB_FOLLOWUP_CLAIM_EVENT, claim("m1", 0)).then(() => null, (e: { code?: string }) => e);
  expect(dup?.code).toBe("23505");
  await ins(db, null, NO_JOB_FOLLOWUP_CLAIM_EVENT, claim("m1", 1));
  await ins(db, null, NO_JOB_FOLLOWUP_CLAIM_EVENT, claim("m2", 0));
  // The key is only unique for the claim type.
  await ins(db, null, FAILED, { message_id: "m1", claim_key: claim("m1", 0).claim_key });
  await expect(db.exec(`UPDATE public.workflow_events SET summary = 'x'`)).rejects.toThrow(/append-only/);
  await expect(db.exec(`DELETE FROM public.workflow_events`)).rejects.toThrow(/append-only/);
  // Rollback refuses while claim/failure rows exist (they can't be deleted from an append-only log).
  await expect(db.exec(read("followup-send-claim.rollback.sql"))).rejects.toThrow(/keep followup-send-claim/);
  await db.close();
});

test("rollback before use restores the previous definition exactly and drops the index", async () => {
  const db = await fixture();
  const before = await constraintDef(db);
  await db.exec(read("followup-send-claim.sql"));
  expect(await constraintDef(db)).not.toBe(before);
  await db.exec(read("followup-send-claim.rollback.sql"));
  expect(await constraintDef(db)).toBe(before);
  const idx = await db.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'workflow_events_nojob_followup_claim_once_idx'`);
  expect(idx.rows).toHaveLength(0);
  for (const t of PREVIOUS) await ins(db, null, t);
  await expect(ins(db, null, NO_JOB_FOLLOWUP_CLAIM_EVENT, claim("m1", 0))).rejects.toThrow(/workflow_events_job_required/);
  await db.close();
});

const DRAFT_FAILED = "email_nojob_ai_draft_failed";

test("before the migration the job-less AI-draft failure row is refused; after, it is allowed", async () => {
  const db = await fixture();
  await expect(ins(db, null, DRAFT_FAILED, { message_id: "m1" })).rejects.toThrow(/workflow_events_job_required/);
  await db.exec(read("followup-send-claim.sql"));
  await ins(db, null, DRAFT_FAILED, { message_id: "m1" });
  await db.close();
});

test("rollback refuses while a job-less AI-draft failure row exists", async () => {
  const db = await fixture();
  await db.exec(read("followup-send-claim.sql"));
  await ins(db, null, DRAFT_FAILED, { message_id: "m1" });
  await expect(db.exec(read("followup-send-claim.rollback.sql"))).rejects.toThrow(/keep followup-send-claim/);
  await db.close();
});
