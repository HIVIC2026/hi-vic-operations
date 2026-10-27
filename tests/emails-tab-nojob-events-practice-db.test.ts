// Decision 414: the three job-less Emails-tab records are allowed; any other job-less record is still refused.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { NO_JOB_DRAFT_CLOSED_EVENT, NO_JOB_DRAFT_EVENT, NO_JOB_REPLY_SENT_EVENT } from "../src/lib/emails-tab.core";

async function db() {
  const d = new PGlite();
  await d.exec(`CREATE TABLE public.workflow_events (id serial primary key, job_id uuid, event_type text not null,
    CONSTRAINT workflow_events_job_required CHECK (job_id IS NOT NULL OR event_type = ANY (ARRAY['email_unmatched','email_unmatched_dismissed','email_new_sender_replied']::text[])));`);
  return d;
}
const ins = (d: PGlite, t: string) => d.query("insert into public.workflow_events (job_id, event_type) values (null, $1)", [t]).then(() => true, () => false);

describe("Emails tab job-less records (decision 414)", () => {
  test("before: refused", async () => { const d = await db(); expect(await ins(d, NO_JOB_DRAFT_EVENT)).toBe(false); });
  test("after: the three are allowed, others still refused", async () => {
    const d = await db();
    await d.exec(readFileSync("docs/pending-migrations/emails-tab-nojob-events.sql", "utf8"));
    for (const t of [NO_JOB_DRAFT_EVENT, NO_JOB_REPLY_SENT_EVENT, NO_JOB_DRAFT_CLOSED_EVENT, "email_unmatched"]) expect(await ins(d, t)).toBe(true);
    expect(await ins(d, "something_else")).toBe(false);
  });
  test("undo restores the old list", async () => {
    const d = await db();
    await d.exec(readFileSync("docs/pending-migrations/emails-tab-nojob-events.sql", "utf8"));
    await d.exec(readFileSync("docs/pending-migrations/emails-tab-nojob-events.undo.sql", "utf8"));
    expect(await ins(d, NO_JOB_DRAFT_EVENT)).toBe(false);
  });
});
