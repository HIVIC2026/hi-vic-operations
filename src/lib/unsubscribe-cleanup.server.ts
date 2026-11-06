// Jo 7 Nov 2026: an email unsubscribe gets the same job clean-up as a STOP text — Do not contact on the job, then an open
// enquiry or saved spot is cancelled "Opted out (unsubscribed)". The opt-out itself is saved first (emailsafety.server). If
// the clean-up throws, one internal `unsubscribe_cleanup_failed` (needs_office) row goes on the job: Needs me shows it and
// the 15-minute tick retries (`retryUnsubscribeCleanups`) until `unsubscribe_cleanup_done` is written. Same pattern as the
// STOP installer-release failure (stop-release.server). `db` is a parameter so the behaviour is testable.
import { UNSUBSCRIBE_CLEANUP_DONE_EVENT, UNSUBSCRIBE_CLEANUP_FAILED_EVENT, unsubscribeCleanupFailedFact } from "./office-needs.core";
import { surnameOf } from "./office-jobs.core";
import { chunked, paged } from "./stop-release.server";

export const UNSUBSCRIBE_RETRY_DAYS = 14;
export const UNSUBSCRIBE_RETRY_MAX_PER_TICK = 20;

/** Do not contact, then the shared opt-out cancel rule. Throws on any failure. */
async function runCleanup(db: any, jobId: string, at: string): Promise<void> {
  const { setDoNotContactFromUnsubscribe } = await import("./do-not-contact-stop.server");
  await setDoNotContactFromUnsubscribe(db, jobId, at);
  const { closeOptedOutJob } = await import("./sms-stop.server");
  const closed = await closeOptedOutJob(db, jobId, "email_unsubscribe", at);
  // A failed installer release already raised its own retried row (`stop_installer_release_failed`).
  if (closed.failure) console.error("unsubscribe: releasing the installer failed", jobId, closed.failure);
}

/** The clean-up after a recorded unsubscribe. Never throws: a failure becomes the office row (or, if even that cannot be
 *  written, a log line). The owner's opt-out is already saved and every email/consent gate reads it either way. */
export async function cleanUpAfterUnsubscribe(db: any, jobId: string, at: string): Promise<void> {
  try {
    await runCleanup(db, jobId, at);
  } catch (e) {
    const message = (e as Error).message;
    console.error("unsubscribe: job clean-up failed", jobId, message);
    try {
      const { error } = await db.from("workflow_events").insert({
        job_id: jobId, actor_id: null, event_type: UNSUBSCRIBE_CLEANUP_FAILED_EVENT, internal: true, created_at: at,
        summary: "Unsubscribe received, but the job clean-up failed — retrying automatically; open the job if this stays",
        details: { source: "email_unsubscribe", error: message.slice(0, 300), needs_office: true },
      });
      if (error) console.error("unsubscribe: could not record the clean-up failure", jobId, error.message);
    } catch (e2) { console.error("unsubscribe: could not record the clean-up failure", jobId, (e2 as Error).message); }
  }
}

/** Jobs whose newest unsubscribe clean-up failure has no later `unsubscribe_cleanup_done`. */
export async function openUnsubscribeCleanupFailures(db: any, o: { onlyIds?: string[]; sinceMs?: number } = {}): Promise<{ jobId: string; at: string }[]> {
  const raised = await paged("unsubscribe clean-up failures", (a, b) => {
    let q = db.from("workflow_events").select("job_id, event_type, created_at, details").eq("event_type", UNSUBSCRIBE_CLEANUP_FAILED_EVENT);
    if (o.onlyIds) q = q.in("job_id", o.onlyIds);
    if (o.sinceMs) q = q.gte("created_at", new Date(o.sinceMs).toISOString());
    return q.order("created_at").order("id").range(a, b);
  });
  const ids = [...new Set(raised.map((e) => String(e["job_id"])))];
  if (!ids.length) return [];
  const done = await chunked("finished unsubscribe clean-ups", ids, (c, a, b) => db.from("workflow_events").select("job_id, event_type, created_at").in("job_id", c).eq("event_type", UNSUBSCRIBE_CLEANUP_DONE_EVENT).order("created_at").order("id").range(a, b));
  const out: { jobId: string; at: string }[] = [];
  for (const id of ids) {
    const hit = unsubscribeCleanupFailedFact([...raised, ...done].filter((e) => String(e["job_id"]) === id).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as Record<string, unknown> | null })));
    if (hit) out.push({ jobId: id, at: hit.at });
  }
  return out;
}

export type UnsubscribeCleanupNeed = { jobId: string; at: string; jobNumber: string; surname: string; suburb: string | null; isTest: boolean };

/** Needs me: the open failures with the job's number / surname / suburb, read whatever the job's stage. */
export async function unsubscribeCleanupNeeds(db: any, o: { includeTest: boolean; onlyIds?: string[] }): Promise<UnsubscribeCleanupNeed[]> {
  const open = await openUnsubscribeCleanupFailures(db, o.onlyIds ? { onlyIds: o.onlyIds } : {});
  if (!open.length) return [];
  const jobs = await chunked("unsubscribe clean-up jobs", open.map((x) => x.jobId), (c, a, b) => db.from("jobs").select("id, job_number, source, deleted_at, owners(full_name), properties(suburb)").in("id", c).range(a, b));
  const byId = new Map(jobs.map((j) => [String(j["id"]), j]));
  return open.flatMap((x) => {
    const j = byId.get(x.jobId);
    if (!j || j["deleted_at"] || (!o.includeTest && j["source"] === "qa_test")) return [];
    return [{ ...x, jobNumber: String(j["job_number"]), surname: surnameOf((j["owners"] as { full_name?: string } | null)?.full_name), suburb: (j["properties"] as { suburb?: string } | null)?.suburb ?? null, isTest: j["source"] === "qa_test" }];
  });
}

/** 15-minute tick: run the clean-up again for open failures (last 14 days, 20 per tick, oldest first). Success writes
 *  `unsubscribe_cleanup_done`, which clears the Needs me row. Uses the original unsubscribe time. */
export async function retryUnsubscribeCleanups(db: any, now: number): Promise<{ tried: number; cleaned: number }> {
  const open = (await openUnsubscribeCleanupFailures(db, { sinceMs: now - UNSUBSCRIBE_RETRY_DAYS * 86_400_000 }))
    .sort((a, b) => a.at.localeCompare(b.at)).slice(0, UNSUBSCRIBE_RETRY_MAX_PER_TICK);
  let cleaned = 0;
  for (const x of open) {
    try {
      await runCleanup(db, x.jobId, x.at);
      const { error } = await db.from("workflow_events").insert({
        job_id: x.jobId, actor_id: null, event_type: UNSUBSCRIBE_CLEANUP_DONE_EVENT, internal: true, created_at: new Date(now).toISOString(),
        summary: "Unsubscribe clean-up done", details: { source: "email_unsubscribe", failed_at: x.at },
      });
      if (error) throw new Error(error.message);
      cleaned++;
    } catch (e) { console.error("unsubscribe clean-up retry failed", x.jobId, (e as Error).message); }
  }
  return { tried: open.length, cleaned };
}
