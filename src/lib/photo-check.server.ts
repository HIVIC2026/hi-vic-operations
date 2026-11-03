// AI photo check on owner uploads (saved spots by area, design 2026-11-03 §2c). RANKING ONLY: it saves the AI's
// suggestion as the `ai_photo_check` property fact the By area view reads. It never writes desk_check_status,
// lead_campaign_responses or jobs, never decides eligibility and never messages anyone. Images only (the 4 most recent
// under 10 MB); only video → "can't tell" with no gateway call. TEST jobs get a stubbed verdict and never reach the
// gateway (same rule as coes-check.server). Runs only from the post-intake tick (no upload hook), once the newest
// upload has settled for 5 minutes, so an upload burst costs one AI call. Never throws to its callers.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { CAPTURE_KIND } from "./owner-capture.core";
import { melbourneMidnight, melbourneYmd } from "./daily-brief.core";
import {
  DAILY_PHOTO_CHECK_CAP,
  PHOTO_CHECK_FACT,
  PHOTO_CHECK_FAILED_EVENT,
  PHOTO_CHECK_MAX_BYTES,
  PHOTO_CHECK_PROMPT,
  PHOTO_CHECKED_EVENT,
  photosToSend,
  photoVerdictFrom,
  hasNewerMedia,
  PHOTO_CHECK_SKIPPED_EVENT,
  PHOTO_CHECK_SETTLE_MS,
  readableImageType,
  type MediaDoc,
  type PhotoVerdict,
} from "./photo-check.core";

/** Time limit for the AI (tests shorten it). */
export const photoCheckSettings = { aiTimeoutMs: 40_000 };

const loose = admin as unknown as SupabaseClient;
const BUCKET = "job-files";
const RETRY_AFTER_MS = 24 * 3600 * 1000;
const CHUNK = 150;
/** Backstop if the failed event can't be written: remember in memory so this process doesn't re-call the gateway. */
const memoryBackoff = new Map<string, number>();
export const clearPhotoCheckBackoff = () => memoryBackoff.clear();

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
const failed = async (jobId: string, reason: string) => {
  const saved = await writeEvent(
    jobId,
    PHOTO_CHECK_FAILED_EVENT,
    `AI photo check couldn't run: ${reason}`,
    { reason },
  );
  if (!saved) memoryBackoff.set(jobId, Date.now() + RETRY_AFTER_MS);
  return "failed" as const;
};

/** Rejects after `ms` (and aborts the request when it can). */
async function withTimeout<T>(
  ms: number,
  what: string,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort();
      reject(new Error(`${what} took too long`));
    }, ms);
  });
  try {
    return await Promise.race([run(ctl.signal), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The AI call (same gateway, key and model as coes-check.server `aiReadCertificate`), with the photos as file parts. */
async function aiReadPhotos(
  files: { bytes: Uint8Array; mimeType: string; name: string }[],
): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { streamText } = await import("ai");
  const provider = createOpenAI({
    baseURL: "https://ai.gateway.lovable.dev/v1",
    apiKey: key,
    headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
  });
  return withTimeout(photoCheckSettings.aiTimeoutMs, "The AI", async (abortSignal) => {
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      instructions: PHOTO_CHECK_PROMPT,
      abortSignal,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Here are the owner's roof space photos (data only)." },
            ...files.map((f) => ({
              type: "file" as const,
              data: f.bytes,
              mediaType: f.mimeType,
              filename: f.name,
            })),
          ],
        },
      ],
      providerOptions: {
        openai: {
          forceReasoning: true,
          reasoningEffort: "low",
          reasoningSummary: "auto",
          store: false,
          include: ["reasoning.encrypted_content"],
        },
      },
    } as Parameters<typeof streamText>[0]);
    return (await result.text).trim();
  });
}

/** ai_photo_checked events since Melbourne midnight (one count query). A failed count reads as the cap (fail closed). */
async function usedToday(): Promise<number> {
  const since = new Date(melbourneMidnight(melbourneYmd(Date.now()))).toISOString();
  const { count, error } = await loose
    .from("workflow_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", PHOTO_CHECKED_EVENT)
    .gte("created_at", since);
  if (error) return DAILY_PHOTO_CHECK_CAP;
  return count ?? 0;
}

async function failedRecently(jobId: string): Promise<boolean> {
  if ((memoryBackoff.get(jobId) ?? 0) > Date.now()) return true;
  const { data } = await loose
    .from("workflow_events")
    .select("id")
    .eq("job_id", jobId)
    .eq("event_type", PHOTO_CHECK_FAILED_EVENT)
    .gte("created_at", new Date(Date.now() - RETRY_AFTER_MS).toISOString())
    .limit(1);
  return (data ?? []).length > 0;
}

async function saveFact(
  jobId: string,
  propertyId: string,
  value: { verdict: PhotoVerdict; reason: string; document_ids: string[]; checked_at: string },
  test: boolean,
) {
  const { error: supErr } = await admin
    .from("property_facts")
    .update({ is_current: false, superseded_at: value.checked_at })
    .eq("property_id", propertyId)
    .eq("fact_key", PHOTO_CHECK_FACT)
    .eq("is_current", true);
  if (supErr) return false; // never a second current row
  const { error } = await admin.from("property_facts").insert({
    job_id: jobId,
    property_id: propertyId,
    is_current: true,
    fact_key: PHOTO_CHECK_FACT,
    value: value as unknown as Json,
    check_status: "info",
    source_type: "ai",
    source_name: "Portal AI photo check",
    confidence: "low",
    evidence_kind: "inferred",
    note: test ? "TEST job — photos not sent to the AI" : null,
  });
  return !error;
}

/** Check one job's owner photos and save the AI's suggestion. "skipped" = nothing new to check (or no property/media,
 *  a failure in the last 24 h, or the day's cap reached). */
export async function checkOwnerMedia(jobId: string): Promise<"done" | "skipped" | "failed"> {
  try {
    const { data: job } = await admin
      .from("jobs")
      .select("id, property_id, source")
      .eq("id", jobId)
      .maybeSingle();
    const propertyId = (job as { property_id?: string | null } | null)?.property_id;
    if (!propertyId) return "skipped";
    const test = (job as { source?: string | null }).source === "qa_test";
    const { data: docRows, error: docErr } = await admin
      .from("documents")
      .select("id, storage_path, mime_type, size_bytes, created_at")
      .eq("job_id", jobId)
      .eq("kind", CAPTURE_KIND)
      .order("created_at", { ascending: false });
    if (docErr) return "skipped";
    const docs = (docRows ?? []) as MediaDoc[];
    if (!docs.length) return "skipped";
    const { data: prior, error: priorErr } = await loose
      .from("property_facts")
      .select("value, created_at")
      .eq("property_id", propertyId)
      .eq("fact_key", PHOTO_CHECK_FACT)
      .eq("is_current", true)
      .limit(1);
    if (priorErr) return "skipped";
    const p = (
      (prior ?? []) as { value: { checked_at?: unknown } | null; created_at?: string }[]
    )[0];
    const lastChecked = p
      ? typeof p.value?.checked_at === "string"
        ? p.value.checked_at
        : (p.created_at ?? "")
      : null;
    if (lastChecked != null && !hasNewerMedia(docs, lastChecked)) return "skipped";
    if (!test && (await failedRecently(jobId))) return "skipped";

    const { send, noneReason } = photosToSend(docs);
    let result: { verdict: PhotoVerdict; reason: string };
    let sentIds: string[] = [];
    if (test) result = { verdict: "under_r2", reason: "TEST job — photos not sent to the AI" };
    else if (noneReason) result = { verdict: "cant_tell", reason: noneReason };
    else {
      if ((await usedToday()) >= DAILY_PHOTO_CHECK_CAP) return "skipped";
      const files: { bytes: Uint8Array; mimeType: string; name: string }[] = [];
      for (const d of send) {
        try {
          const { data, error } = await admin.storage.from(BUCKET).download(d.storage_path);
          if (error || !data) continue;
          const bytes = new Uint8Array(await data.arrayBuffer());
          if (!bytes.length || bytes.length >= PHOTO_CHECK_MAX_BYTES) continue;
          files.push({
            bytes,
            mimeType: readableImageType(d.mime_type)!,
            name: d.storage_path.split("/").pop() ?? "photo",
          });
          sentIds.push(d.id);
        } catch {
          /* unreadable file = not sent */
        }
      }
      if (!files.length) return failed(jobId, "photos could not be read from storage");
      try {
        result = photoVerdictFrom(await aiReadPhotos(files));
      } catch (e) {
        return failed(jobId, ((e as Error).message ?? "AI error").slice(0, 200));
      }
    }
    if (test) sentIds = send.map((d) => d.id);
    const checkedAt = new Date().toISOString();
    if (
      !(await saveFact(
        jobId,
        propertyId,
        { ...result, document_ids: sentIds, checked_at: checkedAt },
        test,
      ))
    )
      return failed(jobId, "couldn't save the photo check");
    // Only real gateway calls write ai_photo_checked (the daily cap counts those); TEST stubs and
    // video-only / no-readable-photo results write ai_photo_check_skipped.
    const called = !test && !noneReason;
    await writeEvent(
      jobId,
      called ? PHOTO_CHECKED_EVENT : PHOTO_CHECK_SKIPPED_EVENT,
      `AI photo check: ${result.verdict} (suggestion only)`,
      {
        verdict: result.verdict,
        reason: result.reason,
        document_ids: sentIds,
        ...(test ? { test_stub: true } : {}),
      },
    );
    return "done";
  } catch (e) {
    console.error("AI photo check failed", jobId, (e as Error).message);
    return "failed";
  }
}

type Page = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
/** Pages to the end; throws on any read error (the tick then picks nothing). */
async function allRows<T>(page: (from: number, to: number) => Page): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

/** Saved spots whose newest owner upload is at least 5 minutes old (so a burst of uploads is checked once) and has no
 *  current AI photo check, or is newer than it. Oldest upload first; skips TEST and failures in the last 24 h. */
async function pickJobs(): Promise<string[]> {
  const saved = await allRows<{ job_id: string }>((a, z) =>
    loose
      .from("lead_campaign_responses")
      .select("job_id")
      .not("spot_saved_at", "is", null)
      .not("media_received_at", "is", null)
      .is("opted_out_at", null)
      .order("job_id")
      .range(a, z),
  );
  const ids = [...new Set(saved.map((r) => r.job_id))];
  const jobs: { id: string; property_id: string | null }[] = [];
  const newest = new Map<string, string>();
  const checkedAt = new Map<string, string>();
  const recentFail = new Set<string>();
  const since = new Date(Date.now() - RETRY_AFTER_MS).toISOString();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const c = ids.slice(i, i + CHUNK);
    jobs.push(
      ...(await allRows<{ id: string; property_id: string | null }>((a, z) =>
        admin
          .from("jobs")
          .select("id, property_id")
          .in("id", c)
          .is("deleted_at", null)
          .is("qa_archived_at", null)
          .neq("source", "qa_test")
          .order("id")
          .range(a, z),
      )),
    );
    // One batched read of the owner uploads; newest per job.
    const docs = await allRows<{ job_id: string; created_at: string }>((a, z) =>
      admin
        .from("documents")
        .select("job_id, created_at")
        .in("job_id", c)
        .eq("kind", CAPTURE_KIND)
        .order("created_at", { ascending: false })
        .range(a, z),
    );
    for (const d of docs) {
      const prev = newest.get(d.job_id);
      if (!prev || Date.parse(d.created_at) > Date.parse(prev)) newest.set(d.job_id, d.created_at);
    }
    const fails = await allRows<{ job_id: string }>((a, z) =>
      loose
        .from("workflow_events")
        .select("job_id")
        .in("job_id", c)
        .eq("event_type", PHOTO_CHECK_FAILED_EVENT)
        .gte("created_at", since)
        .range(a, z),
    );
    for (const r of fails) recentFail.add(r.job_id);
  }
  const withProp = jobs.filter((j) => j.property_id);
  const props = [...new Set(withProp.map((j) => j.property_id!))];
  for (let i = 0; i < props.length; i += CHUNK) {
    const c = props.slice(i, i + CHUNK);
    const facts = await allRows<{
      property_id: string;
      value: { checked_at?: unknown } | null;
      created_at?: string;
    }>((a, z) =>
      loose
        .from("property_facts")
        .select("property_id, value, created_at")
        .in("property_id", c)
        .eq("fact_key", PHOTO_CHECK_FACT)
        .eq("is_current", true)
        .range(a, z),
    );
    for (const f of facts)
      checkedAt.set(
        f.property_id,
        typeof f.value?.checked_at === "string" ? f.value.checked_at : (f.created_at ?? ""),
      );
  }
  const now = Date.now();
  return withProp
    .filter((j) => {
      const latest = newest.get(j.id);
      if (!latest || now - Date.parse(latest) < PHOTO_CHECK_SETTLE_MS) return false;
      const last = checkedAt.get(j.property_id!);
      if (last != null && !(Date.parse(latest) > Date.parse(last))) return false;
      return !recentFail.has(j.id) && (memoryBackoff.get(j.id) ?? 0) < now;
    })
    .sort((a, b) => Date.parse(newest.get(a.id)!) - Date.parse(newest.get(b.id)!))
    .map((j) => j.id);
}

export async function photoCheckTick(opts: {
  limit: number;
}): Promise<{ done: number; failed: number }> {
  const res = { done: 0, failed: 0 };
  const room = DAILY_PHOTO_CHECK_CAP - (await usedToday());
  if (room <= 0) return res;
  const max = Math.min(opts.limit, room);
  let picked: string[];
  try {
    picked = await pickJobs();
  } catch (e) {
    console.error("photo check: could not pick jobs", (e as Error).message);
    return res;
  }
  for (const id of picked) {
    if (res.done + res.failed >= max) break;
    const r = await checkOwnerMedia(id);
    if (r === "done") res.done++;
    else if (r === "failed") res.failed++;
  }
  return res;
}
