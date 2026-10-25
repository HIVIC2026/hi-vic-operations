import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { NEW_SENDER_REPLIED_EVENT, newSenderReplyKey, newSenderTestReplyKey } from "../src/lib/new-sender-reply.core";

// Decision 292: the job-less `email_new_sender_replied` event joins decision 247's two email types in the
// `workflow_events_job_required` check; every other event keeps its job; at most ONE live reply per sender address
// (unique idempotency key); the log stays append-only; the migration is idempotent and runs before or after
// email-unmatched-events.sql. Fixture mirrors drizzle 0000.
const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const JOB = "11111111-1111-4111-8111-111111111111";

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
  return db;
}
const ins = (db: PGlite, job: string | null, type: string, details: Record<string, unknown> = { message_id: "m1", from: "new@example.org" }) =>
  db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, internal) VALUES ($1, $2, 's', $3::jsonb, true)`, [job, type, JSON.stringify(details)]);
const live = (from: string, message: string) => ({ message_id: message, from, mode: "live", idempotency_key: newSenderReplyKey(from) });
const testReply = (from: string, message: string) => ({ message_id: message, from, mode: "test", idempotency_key: newSenderTestReplyKey(message) });

test("the decision-292 event name is the one the migration allows", () => {
  expect(NEW_SENDER_REPLIED_EVENT).toBe("email_new_sender_replied");
  const sql = read("new-sender-reply-events.sql");
  expect(sql).toContain(`'${NEW_SENDER_REPLIED_EVENT}'`);
  expect(sql).toContain("'email_unmatched', 'email_unmatched_dismissed'");
});

test("before the migration a job-less reply event is refused (the copier then records and sends nothing)", async () => {
  const db = await fixture();
  await expect(ins(db, null, NEW_SENDER_REPLIED_EVENT)).rejects.toThrow(/null/i);
  await db.exec(read("email-unmatched-events.sql"));
  // 247 applied alone: still refused by the check (code 23514), never silently accepted.
  await expect(ins(db, null, NEW_SENDER_REPLIED_EVENT)).rejects.toThrow(/workflow_events_job_required/);
  await db.close();
});

for (const order of [["email-unmatched-events.sql", "new-sender-reply-events.sql"], ["new-sender-reply-events.sql", "email-unmatched-events.sql"]] as const) {
  test(`after (${order.join(" then ")}): the email types may have no job; others keep theirs; one live reply per sender; append-only; idempotent`, async () => {
    const db = await fixture();
    for (const f of order) { await db.exec(read(f)); await db.exec(read(f)); }
    await ins(db, null, "email_unmatched");
    await ins(db, null, "email_unmatched_dismissed");
    await ins(db, null, NEW_SENDER_REPLIED_EVENT, live("new@example.org", "m1"));
    await ins(db, JOB, "email_change_request");
    await expect(ins(db, null, "email_change_request")).rejects.toThrow(/workflow_events_job_required/);
    await expect(ins(db, null, "stage_changed")).rejects.toThrow(/workflow_events_job_required/);
    // The once-ever claim: a second live reply to the same address (any message) is refused with 23505.
    const dup = await ins(db, null, NEW_SENDER_REPLIED_EVENT, live("new@example.org", "m2")).then(() => null, (e: { code?: string }) => e);
    expect(dup?.code).toBe("23505");
    await ins(db, null, NEW_SENDER_REPLIED_EVENT, live("other@example.org", "m3"));
    // TEST replies are keyed per message, so Jo can test again; they never take a sender's live claim.
    await ins(db, null, NEW_SENDER_REPLIED_EVENT, testReply("jo@example.org", "t1"));
    await ins(db, null, NEW_SENDER_REPLIED_EVENT, testReply("jo@example.org", "t2"));
    await expect(db.exec(`UPDATE public.workflow_events SET summary = 'x'`)).rejects.toThrow(/append-only/);
    // The once-per-sender read the server makes: `details @> {"from": …}` on the replied type.
    const n = await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.workflow_events WHERE event_type = '${NEW_SENDER_REPLIED_EVENT}' AND details @> '{"from":"new@example.org"}'`);
    expect(n.rows[0]!.n).toBe(1);
    // Rollback refuses while reply events exist (they can't be deleted from an append-only log).
    await expect(db.exec(read("new-sender-reply-events.rollback.sql"))).rejects.toThrow(/keep new-sender-reply-events/);
    await db.close();
  });
}

test("rollback before use narrows the check back to decision 247's two types", async () => {
  const db = await fixture();
  await db.exec(read("email-unmatched-events.sql"));
  await db.exec(read("new-sender-reply-events.sql"));
  await db.exec(read("new-sender-reply-events.rollback.sql"));
  await ins(db, null, "email_unmatched");
  await expect(ins(db, null, NEW_SENDER_REPLIED_EVENT)).rejects.toThrow(/workflow_events_job_required/);
  await db.close();
});
