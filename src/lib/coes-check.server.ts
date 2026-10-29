// A48 batch 1 task 5 (Jo 29 Oct 2026): the electrical certificate (CoES) check — rules and wording in coes-check.core.
// `checkCurrentCoes` is called where the CoES lands on the job: the A4 fixes form completion (fixes-day.server, after the
// files are kept and Section C is merged) and the A3 sync (mitti.server, same-visit q45, after the evidence files are
// kept). "Rectification happened" is the existing PIESA fact `piesaRectificationDone` on the stored answers (outcome
// "repair work is needed" + "repair work completed" Yes — where both the same-visit answers and the A4 merge land).
// The certificate is the q45 media on those answers; its files are the job documents kept for them. The AI (same Lovable
// gateway + model as the AI email replies) reads the PDF/photo as a file part; only a clear "ceiling_work" with a quote
// ticks it. No key, a gateway error, no file, or any other answer → one office event (Needs me row, install blocked).
// An office decision on a certificate is never overwritten by a later AI run. Never throws to its callers.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "./workflow.server";
import {
  COES_CHECKED_EVENT, COES_PROMPT, COES_REJECTED_EVENT, COES_WHY, coesKey, coesOfficeLine, coesState, coesVerdictFromModel,
  type CoesEvent, type CoesFileRef, type CoesVerdict, type CoesWhyCode,
} from "./coes-check.core";

const loose = admin as unknown as SupabaseClient;
type Entry = { label: string; value: string | null; media?: { mediaId: string | null }[] };
const entriesOf = (raw: unknown): Entry[] => (Array.isArray(raw) ? (raw as Entry[]).filter((e) => e && typeof e.label === "string") : []);

/** Is a certificate needed (repairs were done), and which one is on the job now. */
export async function currentCoes(jobId: string): Promise<{ needed: boolean; ref: CoesFileRef | null }> {
  const { data: a } = await admin.from("assessments").select("mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  const entries = entriesOf(a?.mitti_raw_snapshot);
  if (!entries.length) return { needed: false, ref: null };
  const { shortAnswersFromEntries } = await import("./official-short.core");
  const { piesaMediaFromSnapshot, piesaRectificationDone } = await import("./piesa-evidence.core");
  if (!piesaRectificationDone(shortAnswersFromEntries("piesa", entries))) return { needed: false, ref: null };
  const mediaIds = piesaMediaFromSnapshot(entries as never).ces_file.map((m) => m.mediaId).filter((m): m is string => !!m);
  const { FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE } = await import("./fixes-day.core");
  const { data: docs } = await admin.from("documents").select("storage_path, mime_type, external_id").eq("job_id", jobId).eq("kind", FIXES_COES_DOC_KIND).eq("source_system", "mitti").eq("title", FIXES_COES_DOC_TITLE);
  const files: CoesFileRef["files"] = [];
  for (const id of new Set(mediaIds)) {
    const d = ((docs ?? []) as { storage_path: string; mime_type: string | null; external_id: string | null }[]).find((x) => String(x.external_id ?? "").endsWith(`:${id}`));
    if (d) files.push({ storagePath: d.storage_path, mimeType: d.mime_type ?? "application/octet-stream" });
  }
  return { needed: true, ref: { key: coesKey(mediaIds), files } };
}

async function coesEvents(jobId: string): Promise<CoesEvent[]> {
  const { data, error } = await loose.from("workflow_events").select("id, event_type, created_at, details").eq("job_id", jobId).in("event_type", [COES_CHECKED_EVENT, COES_REJECTED_EVENT]).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CoesEvent[];
}

/** The AI call (same gateway, key and model as ai-email-reply.server `aiText`), with the certificate as file parts. */
async function aiReadCertificate(files: { bytes: Uint8Array; mimeType: string; name: string }[]): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { streamText } = await import("ai");
  const provider = createOpenAI({ baseURL: "https://ai.gateway.lovable.dev/v1", apiKey: key, headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  const result = streamText({
    model: provider.responses("openai/gpt-6-astra"),
    instructions: COES_PROMPT,
    messages: [{ role: "user", content: [
      { type: "text", text: "Here is the Certificate of Electrical Safety." },
      ...files.map((f) => ({ type: "file" as const, data: f.bytes, mediaType: f.mimeType, filename: f.name })),
    ] }],
    providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
  } as Parameters<typeof streamText>[0]);
  return (await result.text).trim();
}

const READABLE = /^(application\/pdf|image\/(png|jpe?g|webp|gif))$/i;

/** Check one certificate with the AI and record the result (once per certificate; a failed run is retried later). */
export async function checkCoes(jobId: string, fileRef: CoesFileRef, actorId: string | null = null): Promise<string> {
  try {
    const events = await coesEvents(jobId);
    const prior = coesState(events, fileRef.key);
    const lastWasError = prior.by === "ai" && prior.state === "office" && !!events.filter((e) => e.details?.["key"] === fileRef.key).at(-1)?.details?.["error"];
    if (prior.state !== "unchecked" && !lastWasError) return "already checked";
    let result: CoesVerdict = { verdict: "unsure", quote: null };
    let why: CoesWhyCode | null = null, error: string | null = null;
    const files: { bytes: Uint8Array; mimeType: string; name: string }[] = [];
    for (const f of fileRef.files) {
      if (!READABLE.test(f.mimeType)) continue;
      const { data, error: dlErr } = await admin.storage.from("job-files").download(f.storagePath);
      if (dlErr || !data) continue;
      files.push({ bytes: new Uint8Array(await data.arrayBuffer()), mimeType: f.mimeType.toLowerCase().replace("image/jpg", "image/jpeg"), name: f.storagePath.split("/").pop() ?? "certificate" });
    }
    if (!files.length) { why = "no_file"; error = fileRef.files.length ? "certificate file could not be read" : "no certificate file on the job"; }
    else {
      try { result = coesVerdictFromModel(await aiReadCertificate(files)); }
      catch (e) { why = "ai_error"; error = e instanceof Error ? e.message : "AI error"; }
    }
    if (!why && result.verdict !== "ceiling_work") why = result.verdict;
    // Still failing the same way: the office already has the row — no second event.
    if (lastWasError && why && events.filter((e) => e.details?.["key"] === fileRef.key).at(-1)?.details?.["why"] === why) return `still with the office (${why})`;
    const ticked = !why;
    await logEvent(jobId, actorId, COES_CHECKED_EVENT,
      ticked ? "Electrical certificate checked by AI — it describes the ceiling-space repairs" : coesOfficeLine(COES_WHY[why!]),
      { by: "ai", verdict: result.verdict, quote: result.quote, key: fileRef.key, files: fileRef.files.map((f) => f.storagePath), ...(why ? { why, needs_office: true } : {}), ...(error ? { error: error.slice(0, 300) } : {}) },
      { internal: true });
    return ticked ? "ticked by AI" : `sent to the office (${why})`;
  } catch (e) {
    console.error("electrical certificate not checked", jobId, (e as Error).message);
    return `not checked — ${(e as Error).message}`;
  }
}

/** Where a CoES lands on the job: check the current certificate when repairs were done. Never throws. */
export async function checkCurrentCoes(jobId: string, actorId: string | null): Promise<string> {
  try {
    const c = await currentCoes(jobId);
    if (!c.needed || !c.ref) return "skipped: no repairs, no certificate needed";
    return await checkCoes(jobId, c.ref, actorId);
  } catch (e) {
    console.error("electrical certificate not checked", jobId, (e as Error).message);
    return `not checked — ${(e as Error).message}`;
  }
}

/** Install-day gate: repairs were done and the current certificate isn't ticked → "Check electrical certificate — {why}". */
export async function coesBlockerFor(jobId: string): Promise<string | null> {
  const c = await currentCoes(jobId);
  if (!c.needed || !c.ref) return null;
  const s = coesState(await coesEvents(jobId), c.ref.key);
  return s.state === "ticked" ? null : coesOfficeLine(s.why ?? COES_WHY.not_checked);
}

/** The Needs me row's event → its certificate, refusing a row that a newer certificate has replaced. */
async function openRow(eventId: string): Promise<{ jobId: string; key: string; checkEventId: string }> {
  const { data: ev } = await loose.from("workflow_events").select("id, job_id, event_type, details").eq("id", eventId).maybeSingle();
  const row = ev as { id: string; job_id: string | null; event_type: string; details: Record<string, unknown> | null } | null;
  if (!row?.job_id || (row.event_type !== COES_CHECKED_EVENT && row.event_type !== COES_REJECTED_EVENT) || typeof row.details?.["key"] !== "string") throw new Error("That certificate check wasn't found.");
  const key = row.details["key"] as string;
  const c = await currentCoes(row.job_id);
  if (!c.needed || !c.ref) throw new Error("This job no longer needs an electrical certificate.");
  if (c.ref.key !== key) throw new Error("A newer certificate has come in — refresh and check that one.");
  return { jobId: row.job_id, key, checkEventId: row.id };
}

/** Office Tick: the certificate covers the ceiling-space repairs (the install day can be booked). */
export async function officeTickCoes(eventId: string, actorId: string): Promise<{ ok: true }> {
  const r = await openRow(eventId);
  if (coesState(await coesEvents(r.jobId), r.key).state === "ticked") throw new Error("This certificate is already ticked.");
  await logEvent(r.jobId, actorId, COES_CHECKED_EVENT, "Electrical certificate ticked by the office", { by: "office", verdict: "ceiling_work", quote: null, key: r.key, check_event_id: r.checkEventId }, { internal: true });
  return { ok: true };
}

/** Office Reject: not good enough — the install stays blocked until a new certificate comes in (checked again). */
export async function officeRejectCoes(eventId: string, note: string, actorId: string): Promise<{ ok: true }> {
  const r = await openRow(eventId);
  const n = note.trim().slice(0, 500);
  await logEvent(r.jobId, actorId, COES_REJECTED_EVENT, `Electrical certificate rejected by the office${n ? `: ${n}` : ""}`.slice(0, 500), { by: "office", note: n || null, key: r.key, check_event_id: r.checkEventId }, { internal: true });
  return { ok: true };
}
