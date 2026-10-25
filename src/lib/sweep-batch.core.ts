// Pure helpers for the 15-minute tick sweeps (perf 25 Oct 2026): sweeps read the facts they decide on for ALL candidate
// jobs at once (bounded id chunks) instead of a handful of queries per job, then run the existing guarded per-job path
// only for the jobs that are actually due. These helpers only group rows; every decision stays in its own core.

/** Bounded id chunks: one URL carrying every job id exceeds the gateway limit (AGENTS: "Office bulk lookups by job id are batched"). */
export const SWEEP_ID_CHUNK = 150;
export function chunkIds<T>(ids: T[], size = SWEEP_ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Rows grouped by job id, in the order given. Rows without a job id are dropped. */
export function groupByJob<T extends { job_id: string | null }>(rows: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) { if (!r.job_id) continue; const k = r.job_id; if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
  return m;
}

/** The newest row per job by `created_at` (same as `.order("created_at", { ascending: false }).limit(1)` per job;
 *  on an exact tie the first row given wins). */
export function latestPerJob<T extends { job_id: string | null; created_at: string | null }>(rows: T[]): Map<string, T> {
  const m = new Map<string, T>();
  for (const r of rows) {
    if (!r.job_id) continue;
    const cur = m.get(r.job_id);
    if (!cur || String(r.created_at ?? "") > String(cur.created_at ?? "")) m.set(r.job_id, r);
  }
  return m;
}

/** Steps already recorded for ONE record (events carry `{ step, piesa_record_id }` in details). */
export function stepsForRecord<S extends string>(events: { details: unknown }[], recordId: string): S[] {
  const out: S[] = [];
  for (const e of events) {
    const d = (e.details ?? null) as { step?: unknown; piesa_record_id?: unknown } | null;
    if (d && d.piesa_record_id === recordId && typeof d.step === "string" && d.step) out.push(d.step as S);
  }
  return out;
}
