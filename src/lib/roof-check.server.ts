// Roof check for saved spots (Google Solar Building Insights). RANKING ONLY: it writes roof facts the By area view reads,
// and never decides eligibility, changes a job, or messages anyone. Must not import eligibility.server or postintake.server.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { parseStreet } from "./address-complete.core";
import {
  defaultProviderHttp,
  providerConfigFromEnv,
  runSolar,
  type ProviderHttp,
  type ProviderResult,
} from "./providers.gather";
import { melbourneMidnight, melbourneYmd } from "./daily-brief.core";
import { ensurePropertyCoordinates } from "./property-coordinates.server";

const loose = admin as unknown as SupabaseClient;
export const ROOF_KEYS = [
  "roof_form",
  "site_roof_risk",
  "building_ground_footprint",
  "solar_summary",
] as const;
const RETRY_AFTER_MS = 24 * 3600 * 1000;
const CHUNK = 150;
/** Portal-side guard so Google cost stays inside the free amount: stop for the day after this many lookups (done + failed). */
export const DAILY_ROOF_CHECK_CAP = 300;

const hash = async (v: unknown) => {
  const b = new TextEncoder().encode(JSON.stringify(v ?? null));
  const d = await crypto.subtle.digest("SHA-256", b);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
};
const chunks = <T>(a: T[]) => {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += CHUNK) out.push(a.slice(i, i + CHUNK));
  return out;
};
const NO_COVERAGE_RETRY_MS = 7 * 24 * 3600 * 1000;
const STARTED = "roof_check_started";
const CHECKED = "roof_checked";
const FAILED = "roof_check_failed";
/** Backstop if the event row can't be written: remember in memory so this process doesn't re-call Google. */
const memoryBackoff = new Map<string, number>();
export const clearRoofCheckBackoff = () => memoryBackoff.clear();
/** Writes the workflow event directly (not logEvent, which also bumps jobs.last_activity_at). Never throws. */
const writeEvent = async (
  jobId: string,
  type: string,
  summary: string,
  details: Record<string, unknown>,
) => {
  try {
    const { error } = await admin.from("workflow_events").insert({
      job_id: jobId,
      actor_id: null,
      event_type: type,
      summary,
      details: details as Json,
      from_stage: null,
      to_stage: null,
      internal: true,
    });
    return !error;
  } catch {
    return false;
  }
};
const failed = async (jobId: string, reason: string, noCoverage = false) => {
  const saved = await writeEvent(jobId, FAILED, `Roof check couldn't run: ${reason}`, {
    reason,
    ...(noCoverage ? { no_coverage: true } : {}),
  });
  if (!saved)
    memoryBackoff.set(jobId, Date.now() + (noCoverage ? NO_COVERAGE_RETRY_MS : RETRY_AFTER_MS));
  return "failed" as const;
};

export async function runRoofCheck(
  jobId: string,
  http: ProviderHttp = defaultProviderHttp,
): Promise<"done" | "skipped" | "failed"> {
  const key = providerConfigFromEnv(process.env as Record<string, string | undefined>).solarKey;
  if (!key) return "skipped";
  const { data: job } = await admin
    .from("jobs")
    .select("id, property_id, source")
    .eq("id", jobId)
    .maybeSingle();
  if (!job?.property_id || job.source === "qa_test") return "skipped";
  // Recorded BEFORE any paid lookup (geocoding, Solar): if the request is cut off, this start still counts toward the
  // daily cap and blocks the job for 24 h. If it can't be recorded, nothing is called.
  if (!(await writeEvent(jobId, STARTED, "Roof check started", {}))) {
    memoryBackoff.set(jobId, Date.now() + RETRY_AFTER_MS);
    return "failed";
  }
  let point: [number, number] | null = null;
  try {
    const { data: c } = await admin
      .from("property_facts")
      .select("value")
      .eq("property_id", job.property_id)
      .eq("fact_key", "coordinates")
      .eq("is_current", true)
      .limit(1)
      .maybeSingle();
    const v = c?.value;
    point =
      Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number")
        ? (v as [number, number])
        : null;
    point ??= await ensurePropertyCoordinates(jobId, job.property_id);
  } catch {
    point = null;
  }
  if (!point) return failed(jobId, "no location for the address");

  const out: ProviderResult = {
    facts: [],
    checks: [],
    areas: [],
    floorplans: [],
    storagePolicy: "unknown",
  };
  try {
    await runSolar(
      key,
      { prefix: null, postcode: null, point, referenceDate: new Date().toISOString().slice(0, 10) },
      http,
      out,
    );
  } catch (e) {
    return failed(jobId, ((e as Error).message ?? "lookup failed").slice(0, 200));
  }
  const chk = out.checks[0];
  if (!chk || chk.status !== "ok")
    return failed(
      jobId,
      chk ? `${chk.status}${chk.error ? `: ${chk.error}` : ""}` : "no answer",
      chk?.status === "no_coverage",
    );

  const facts = out.facts.filter((f) => (ROOF_KEYS as readonly string[]).includes(f.key));
  if (!facts.length) return failed(jobId, "no roof facts in the answer");
  const rows = await Promise.all(
    facts.map(async (f) => ({
      job_id: jobId,
      property_id: job.property_id,
      is_current: true,
      fact_key: f.key,
      value: (f.value ?? null) as Json,
      check_status: f.status,
      source_type: f.sourceType,
      source_name: f.sourceName,
      source_url: f.sourceUrl ?? null,
      source_record_id: f.sourceRecordId ?? null,
      source_date: f.sourceDate ?? null,
      confidence: f.confidence,
      evidence_kind: f.evidence,
      note: f.note ?? null,
      raw_snapshot: (f.raw ?? null) as Json,
      raw_hash: f.raw ? await hash(f.raw) : null,
    })),
  );
  await admin
    .from("property_facts")
    .update({ is_current: false, superseded_at: new Date().toISOString() })
    .eq("property_id", job.property_id)
    .eq("is_current", true)
    .in("fact_key", [...ROOF_KEYS]);
  const { error } = await admin.from("property_facts").insert(rows);
  if (error) return failed(jobId, "couldn't save the roof facts");
  const form = facts.find((f) => f.key === "roof_form")?.value;
  await writeEvent(
    jobId,
    CHECKED,
    `Roof check done (roof: ${typeof form === "string" ? form : "unknown"})`,
    { roof_form: form ?? null },
  );
  return "done";
}

/** Saved spots still waiting (our leads only), newest saved first, with a street address, no roof_form yet, and no failed try in the last 24 h. */
async function pickJobs(): Promise<string[]> {
  const saved: { job_id: string; spot_saved_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await loose
      .from("lead_campaign_responses")
      .select("job_id, spot_saved_at")
      .not("spot_saved_at", "is", null)
      .is("opted_out_at", null)
      .order("spot_saved_at", { ascending: false })
      .range(from, from + 999);
    saved.push(...((data ?? []) as typeof saved));
    if ((data ?? []).length < 1000) break;
  }
  const savedAt = new Map(saved.map((s) => [s.job_id, s.spot_saved_at]));
  const jobs: {
    id: string;
    property_id: string | null;
    properties: { address_line: string | null } | null;
  }[] = [];
  for (const c of chunks([...savedAt.keys()])) {
    const { data } = await admin
      .from("jobs")
      .select("id, property_id, properties(address_line)")
      .in("id", c)
      .eq("stage", "ready_check_ready_to_schedule")
      .eq("channel", "hivic_sourced") // our leads only, as To release shows
      .is("deleted_at", null)
      .is("qa_archived_at", null)
      .neq("source", "qa_test");
    jobs.push(...((data ?? []) as unknown as typeof jobs));
  }
  const eligible = jobs.filter((j) => j.property_id && parseStreet(j.properties?.address_line));
  const hasRoof = new Set<string>();
  const recentFail = new Set<string>();
  const now = Date.now();
  const since = new Date(now - NO_COVERAGE_RETRY_MS).toISOString();
  for (const c of chunks(eligible.map((j) => j.property_id!))) {
    const { data } = await loose
      .from("property_facts")
      .select("property_id")
      .in("property_id", c)
      .eq("fact_key", "roof_form")
      .eq("is_current", true);
    for (const r of (data ?? []) as { property_id: string }[]) hasRoof.add(r.property_id);
  }
  for (const c of chunks(eligible.map((j) => j.id))) {
    const { data } = await loose
      .from("workflow_events")
      .select("job_id, event_type, details, created_at")
      .in("job_id", c)
      .in("event_type", [STARTED, CHECKED, FAILED])
      .gte("created_at", since);
    const lastStart = new Map<string, number>();
    const lastEnd = new Map<string, number>();
    for (const r of (data ?? []) as {
      job_id: string;
      event_type: string;
      details: { no_coverage?: boolean } | null;
      created_at: string;
    }[]) {
      const t = Date.parse(r.created_at);
      if (r.event_type === FAILED) {
        const window = r.details?.no_coverage ? NO_COVERAGE_RETRY_MS : RETRY_AFTER_MS;
        if (now - t < window) recentFail.add(r.job_id);
      }
      if (now - t >= RETRY_AFTER_MS) continue;
      const m = r.event_type === STARTED ? lastStart : lastEnd;
      m.set(r.job_id, Math.max(m.get(r.job_id) ?? -Infinity, t));
    }
    // A start with no result after it (the request was cut off) counts as a failure for 24 h.
    for (const [job, t] of lastStart) if (t > (lastEnd.get(job) ?? -Infinity)) recentFail.add(job);
  }
  return eligible
    .filter(
      (j) =>
        !hasRoof.has(j.property_id!) &&
        !recentFail.has(j.id) &&
        (memoryBackoff.get(j.id) ?? 0) < now,
    )
    .sort((a, b) => String(savedAt.get(b.id)).localeCompare(String(savedAt.get(a.id))))
    .map((j) => j.id);
}

/** Lookups since Melbourne midnight: one roof_check_started per run (results kept as a floor for runs made before
 *  starts were recorded). A failed count reads as the cap (fail closed). */
async function usedToday(): Promise<number> {
  const since = new Date(melbourneMidnight(melbourneYmd(Date.now()))).toISOString();
  const count = (types: string[]) =>
    loose
      .from("workflow_events")
      .select("id", { count: "exact", head: true })
      .in("event_type", types)
      .gte("created_at", since);
  const [started, results] = await Promise.all([count([STARTED]), count([CHECKED, FAILED])]);
  if (started.error || results.error) return DAILY_ROOF_CHECK_CAP;
  return Math.max(started.count ?? 0, results.count ?? 0);
}

export async function roofCheckTick(opts: {
  limit: number;
  http?: ProviderHttp;
}): Promise<{ done: number; failed: number }> {
  const res = { done: 0, failed: 0 };
  if (!providerConfigFromEnv(process.env as Record<string, string | undefined>).solarKey)
    return res;
  const room = DAILY_ROOF_CHECK_CAP - (await usedToday());
  if (room <= 0) return res;
  const max = Math.min(opts.limit, room);
  const attempted = new Set<string>();
  for (const id of await pickJobs()) {
    if (res.done + res.failed >= max) break;
    if (attempted.has(id)) continue;
    attempted.add(id);
    try {
      const r = await runRoofCheck(id, opts.http);
      if (r === "done") res.done++;
      else if (r === "failed") res.failed++;
    } catch (e) {
      console.error("roof check failed", (e as Error).message);
      res.failed++;
    }
  }
  return res;
}
