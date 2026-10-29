// STOP clean-up failures (batch 2): a STOP reply cancelled the job but releasing the installer failed afterwards
// (`stop_installer_release_failed`). The job is already cancelled, so "cancel again" is impossible; instead the 15-minute
// tick retries the release (`retryStopReleases`) and Needs me shows the row until a later `job_cancel_released` exists.
// `db` is a parameter so the behaviour is testable without the live client.
import { stopReleaseFailedFact } from "./office-needs.core";
import { surnameOf } from "./office-jobs.core";

type Row = Record<string, unknown>;
type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
export const STOP_RETRY_DAYS = 14;
export const STOP_RETRY_MAX_PER_TICK = 20;

async function paged(what: string, page: (a: number, b: number) => Page): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}
async function chunked(what: string, ids: string[], q: (chunk: string[], a: number, b: number) => Page): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += 150) out.push(...(await paged(what, (a, b) => q(ids.slice(i, i + 150), a, b))));
  return out;
}

/** Jobs whose newest STOP release failure has no later `job_cancel_released` (cancelled or not). */
export async function openStopReleaseFailures(db: any, o: { onlyIds?: string[]; sinceMs?: number } = {}): Promise<{ jobId: string; at: string }[]> {
  const stops = await paged("STOP release failures", (a, b) => {
    let q = db.from("workflow_events").select("job_id, event_type, created_at, details").eq("event_type", "stop_installer_release_failed");
    if (o.onlyIds) q = q.in("job_id", o.onlyIds);
    if (o.sinceMs) q = q.gte("created_at", new Date(o.sinceMs).toISOString());
    return q.order("created_at").order("id").range(a, b);
  });
  const ids = [...new Set(stops.map((e) => String(e["job_id"])))];
  if (!ids.length) return [];
  const rel = await chunked("cancel releases of STOP jobs", ids, (c, a, b) => db.from("workflow_events").select("job_id, event_type, created_at").in("job_id", c).eq("event_type", "job_cancel_released").order("created_at").order("id").range(a, b));
  const out: { jobId: string; at: string }[] = [];
  for (const id of ids) {
    const hit = stopReleaseFailedFact([...stops, ...rel].filter((e) => String(e["job_id"]) === id).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as Record<string, unknown> | null })));
    if (hit) out.push({ jobId: id, at: hit.at });
  }
  return out;
}

export type StopReleaseNeed = { jobId: string; at: string; jobNumber: string; surname: string; suburb: string | null; isTest: boolean };

/** Needs me: the open failures with the job's number / surname / suburb, read even when the job is cancelled. */
export async function stopReleaseNeeds(db: any, o: { includeTest: boolean; onlyIds?: string[] }): Promise<StopReleaseNeed[]> {
  const open = await openStopReleaseFailures(db, o.onlyIds ? { onlyIds: o.onlyIds } : {});
  if (!open.length) return [];
  const jobs = await chunked("STOP failure jobs", open.map((x) => x.jobId), (c, a, b) => db.from("jobs").select("id, job_number, source, deleted_at, owners(full_name), properties(suburb)").in("id", c).range(a, b));
  const byId = new Map(jobs.map((j) => [String(j["id"]), j]));
  return open.flatMap((x) => {
    const j = byId.get(x.jobId);
    if (!j || j["deleted_at"] || (!o.includeTest && j["source"] === "qa_test")) return [];
    return [{ ...x, jobNumber: String(j["job_number"]), surname: surnameOf((j["owners"] as { full_name?: string } | null)?.full_name), suburb: (j["properties"] as { suburb?: string } | null)?.suburb ?? null, isTest: j["source"] === "qa_test" }];
  });
}

/** 15-minute tick: retry releasing the installer for CANCELLED jobs with an unreleased STOP failure (14 days, 20 per tick). */
export async function retryStopReleases(db: any, now: number, release: (jobId: string) => Promise<unknown>): Promise<{ tried: number; released: number }> {
  const open = await openStopReleaseFailures(db, { sinceMs: now - STOP_RETRY_DAYS * 86_400_000 });
  if (!open.length) return { tried: 0, released: 0 };
  const jobs = await chunked("STOP retry jobs", open.map((x) => x.jobId), (c, a, b) => db.from("jobs").select("id, stage, source").in("id", c).range(a, b));
  const cancelled = new Set(jobs.filter((j) => j["stage"] === "cancelled" && j["source"] !== "qa_test").map((j) => String(j["id"])));
  const todo = open.filter((x) => cancelled.has(x.jobId)).sort((a, b) => a.at.localeCompare(b.at)).slice(0, STOP_RETRY_MAX_PER_TICK);
  let released = 0;
  for (const x of todo) { try { await release(x.jobId); released++; } catch (e) { console.error("STOP release retry failed", x.jobId, (e as Error).message); } }
  return { tried: todo.length, released };
}
