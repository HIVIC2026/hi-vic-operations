import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { EMAIL_AUTO_REPLIED_EVENT, EMAIL_AUTO_REPLY_FILED_EVENT, EMAIL_AUTO_REPLY_HELD_EVENT, autoReplyKey } from "../src/lib/owner-email-auto-reply.core";

// Decision 386: ONE `email_auto_replied` claim per Outlook message (unique idempotency key) so two copier runs can never
// both send; held / filed events and every other event are unaffected; the log stays append-only; the migration is
// idempotent, runs before or after the other email migrations, and the rollback drops only its two indexes.
// Fixture mirrors drizzle 0000 (job_id NOT NULL, append-only trigger).
const read = (name: string) => readFileSync(new URL(`../docs/pending-migrations/${name}`, import.meta.url), "utf8");
const JOB = "11111111-1111-4111-8111-111111111111";
const JOB2 = "22222222-2222-4222-8222-222222222222";

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
    INSERT INTO public.jobs (id) VALUES ('${JOB}'), ('${JOB2}');`);
  return db;
}
const ins = (db: PGlite, job: string, type: string, details: Record<string, unknown>) =>
  db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details, internal) VALUES ($1, $2, 's', $3::jsonb, true)`, [job, type, JSON.stringify(details)]);
const claim = (message: string) => ({ message_id: message, idempotency_key: autoReplyKey(message), mode: "live", answer: "spot_saved" });
const code = (p: Promise<unknown>) => p.then(() => null, (e: { code?: string }) => e.code ?? "error");

test("the event names and key are the ones the migration indexes", () => {
  const sql = read("owner-email-auto-reply-events.sql");
  expect(sql).toContain(`event_type = '${EMAIL_AUTO_REPLIED_EVENT}'`);
  for (const t of [EMAIL_AUTO_REPLIED_EVENT, EMAIL_AUTO_REPLY_HELD_EVENT, EMAIL_AUTO_REPLY_FILED_EVENT]) expect(sql).toContain(`'${t}'`);
  expect(autoReplyKey("AAMk1")).toBe("owner-email-auto-reply:v1:AAMk1");
  // No check-constraint change is needed: every decision-386 event has its job.
  const statements = sql.replace(/^\s*--.*$/gm, "");
  expect(statements).not.toMatch(/alter table|constraint/i);
});

test("before the migration a second claim for the same message is NOT refused (the server's read-then-insert check is the only guard)", async () => {
  const db = await fixture();
  await ins(db, JOB, EMAIL_AUTO_REPLIED_EVENT, claim("m1"));
  expect(await code(ins(db, JOB, EMAIL_AUTO_REPLIED_EVENT, claim("m1")))).toBeNull();
  await db.close();
});

for (const order of [["email-unmatched-events.sql", "new-sender-reply-events.sql", "owner-email-auto-reply-events.sql"], ["owner-email-auto-reply-events.sql", "email-unmatched-events.sql", "new-sender-reply-events.sql"]] as const) {
  test(`after (${order.join(" then ")}): one claim per message, other events free, append-only, idempotent`, async () => {
    const db = await fixture();
    for (const f of order) { await db.exec(read(f)); await db.exec(read(f)); }
    await ins(db, JOB, EMAIL_AUTO_REPLIED_EVENT, claim("m1"));
    // Same Outlook message again (sync + office match, or a retry): refused with 23505 → nothing is sent.
    expect(await code(ins(db, JOB, EMAIL_AUTO_REPLIED_EVENT, claim("m1")))).toBe("23505");
    expect(await code(ins(db, JOB2, EMAIL_AUTO_REPLIED_EVENT, claim("m1")))).toBe("23505");
    // Another message from the same owner is answered on its own.
    await ins(db, JOB, EMAIL_AUTO_REPLIED_EVENT, claim("m2"));
    // Held / filed events and the Needs me row type carry the same key or message freely.
    await ins(db, JOB, EMAIL_AUTO_REPLY_HELD_EVENT, { ...claim("m2"), status: "blocked" });
    await ins(db, JOB, EMAIL_AUTO_REPLY_FILED_EVENT, { message_id: "m1", idempotency_key: autoReplyKey("m1"), status: "archived" });
    await ins(db, JOB, "email_change_request", { message_id: "m3", intent: "reply" });
    await ins(db, JOB, "email_change_request", { message_id: "m3", intent: "reply" });
    // Every decision-386 event still needs its job.
    await expect(db.query(`INSERT INTO public.workflow_events (job_id, event_type, summary, details) VALUES (NULL, '${EMAIL_AUTO_REPLIED_EVENT}', 's', '{}'::jsonb)`)).rejects.toThrow(/null|workflow_events_job_required/i);
    await expect(db.exec(`UPDATE public.workflow_events SET summary = 'x'`)).rejects.toThrow(/append-only/);
    // The prior-claim read the server makes: `details @> {"message_id": …}` on the replied / held types.
    const n = await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.workflow_events WHERE event_type IN ('${EMAIL_AUTO_REPLIED_EVENT}','${EMAIL_AUTO_REPLY_HELD_EVENT}') AND details @> '{"message_id":"m2"}'`);
    expect(n.rows[0]!.n).toBe(2);
    await db.close();
  });
}

test("rollback drops only the two indexes; claims written stay", async () => {
  const db = await fixture();
  await db.exec(read("owner-email-auto-reply-events.sql"));
  await ins(db, JOB, EMAIL_AUTO_REPLIED_EVENT, claim("m1"));
  await db.exec(read("owner-email-auto-reply-events.rollback.sql"));
  await db.exec(read("owner-email-auto-reply-events.rollback.sql"));
  const idx = await db.query<{ n: number }>(`SELECT count(*)::int n FROM pg_indexes WHERE indexname LIKE 'workflow_events_email_auto_reply%'`);
  expect(idx.rows[0]!.n).toBe(0);
  expect(await code(ins(db, JOB, EMAIL_AUTO_REPLIED_EVENT, claim("m1")))).toBeNull();
  const rows = await db.query<{ n: number }>(`SELECT count(*)::int n FROM public.workflow_events`);
  expect(rows.rows[0]!.n).toBe(2);
  await db.close();
});
