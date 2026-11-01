// A48 batch 1 task 5 (Jo 29 Oct 2026): the electrical certificate (CoES) check — rules and wording in coes-check.core.
// "Repairs happened", from existing facts:
//  - Mitti: `piesaRectificationDone` on the stored PIESA answers (outcome "repair work is needed" + "completed" Yes), where
//    both the A3 same-visit answers and the A4 fixes form merge land. The certificate = the q45 media on those answers;
//    its files = the job documents kept for them (kind piesa_evidence, FIXES_COES_DOC_TITLE).
//  - Portal "record fixes done" page (no Mitti fixes form): a post_rectification PIESA record. The certificate = the fixes
//    evidence uploaded on that page (evidence_files of the job's `rectification_completion` requirement, job-files bucket).
// `checkCurrentCoes` runs after the CoES is kept: end of the A4 completion (fixes-day.server), the A3 sync (mitti.server),
// and the portal record (portal.functions recordPiesa). The AI (same Lovable gateway + model as the AI email replies)
// reads the PDF/photo as a file part, with a time limit; only a strict-JSON "ceiling_work" with a quote (found in the PDF's
// text layer when it has one) ticks it. TEST jobs get a stubbed verdict and never reach the gateway. No key, a gateway
// error or time-out, no file, or any other answer → one office event (Needs me row, install blocked). An office decision
// is never overwritten by an automatic run; the office's "Check again" asks for a fresh one. Never throws to its callers.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logEvent } from "./workflow.server";
import {
  COES_CHECKED_EVENT, COES_PROMPT, COES_REJECTED_EVENT, COES_WHY, coesKey, coesNeedsFact, coesOfficeLine, coesPortalKey, coesQuoteCheck, coesReadableType, coesState, coesVerdictFromModel,
  type CoesEvent, type CoesFileRef, type CoesVerdict, type CoesWhyCode,
} from "./coes-check.core";

/** Time limits (tests shorten them). The AI gets ~40s; reading a PDF's text layer gets 10s. */
export const coesSettings = { aiTimeoutMs: 40_000, pdfTextTimeoutMs: 10_000 };

const loose = admin as unknown as SupabaseClient;
type Entry = { label: string; value: string | null; media?: { mediaId: string | null }[] };
const entriesOf = (raw: unknown): Entry[] => (Array.isArray(raw) ? (raw as Entry[]).filter((e) => e && typeof e.label === "string") : []);

export type CurrentCoes = { needed: boolean; ref: CoesFileRef | null; since: string | null; source: "mitti" | "portal" | null };

/** Is a certificate needed (repairs were done), and which one is on the job now. */
export async function currentCoes(jobId: string): Promise<CurrentCoes> {
  const { data: a } = await admin.from("assessments").select("mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  const entries = entriesOf(a?.mitti_raw_snapshot);
  if (entries.length) {
    const { shortAnswersFromEntries } = await import("./official-short.core");
    const { piesaMediaFromSnapshot, piesaRectificationDone } = await import("./piesa-evidence.core");
    if (piesaRectificationDone(shortAnswersFromEntries("piesa", entries))) {
      const mediaIds = piesaMediaFromSnapshot(entries as never).ces_file.map((m) => m.mediaId).filter((m): m is string => !!m);
      const { FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE } = await import("./fixes-day.core");
      const { data: docs } = await admin.from("documents").select("storage_path, mime_type, external_id, created_at").eq("job_id", jobId).eq("kind", FIXES_COES_DOC_KIND).eq("source_system", "mitti").eq("title", FIXES_COES_DOC_TITLE);
      const files: CoesFileRef["files"] = [];
      let since: string | null = null;
      for (const id of new Set(mediaIds)) {
        const d = ((docs ?? []) as { storage_path: string; mime_type: string | null; external_id: string | null; created_at?: string | null }[]).find((x) => String(x.external_id ?? "").endsWith(`:${id}`));
        if (d) { files.push({ storagePath: d.storage_path, mimeType: d.mime_type ?? "application/octet-stream" }); if (d.created_at && (!since || d.created_at > since)) since = d.created_at; }
      }
      return { needed: true, ref: { key: coesKey(mediaIds), files }, since, source: "mitti" };
    }
  }
  // Portal "record fixes done" page: a post_rectification record, with the fixes evidence uploaded on that page.
  const { data: rec } = await admin.from("piesa_records").select("created_at").eq("job_id", jobId).eq("kind", "post_rectification").order("created_at", { ascending: false }).limit(1);
  const recAt = ((rec ?? []) as { created_at: string }[])[0]?.created_at ?? null;
  if (!recAt) return { needed: false, ref: null, since: null, source: null };
  const { data: req } = await admin.from("evidence_requirements").select("id").eq("job_id", jobId).eq("category", "rectification_completion");
  const reqIds = ((req ?? []) as { id: string }[]).map((r) => r.id);
  const { data: ev } = reqIds.length ? await admin.from("evidence_files").select("id, storage_path, mime_type, uploaded_at").eq("job_id", jobId).in("requirement_id", reqIds) : { data: [] };
  const rows = (ev ?? []) as { id: string; storage_path: string; mime_type: string | null; uploaded_at: string | null }[];
  return { needed: true, ref: { key: coesPortalKey(rows.map((r) => r.id)), files: rows.map((r) => ({ storagePath: r.storage_path, mimeType: r.mime_type ?? "application/octet-stream" })) }, since: recAt, source: "portal" };
}

async function coesEvents(jobId: string): Promise<CoesEvent[]> {
  const { data, error } = await loose.from("workflow_events").select("id, event_type, created_at, details").eq("job_id", jobId).in("event_type", [COES_CHECKED_EVENT, COES_REJECTED_EVENT]).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CoesEvent[];
}

/** Rejects after `ms` (and aborts the request when it can). */
async function withTimeout<T>(ms: number, what: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => { ctl.abort(); reject(new Error(`${what} took too long`)); }, ms); });
  try { return await Promise.race([run(ctl.signal), late]); } finally { clearTimeout(timer); }
}

/** The AI call (same gateway, key and model as ai-email-reply.server `aiText`), with the certificate as file parts. */
async function aiReadCertificate(files: { bytes: Uint8Array; mimeType: string; name: string }[]): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured");
  const { createOpenAI } = await import("@ai-sdk/openai");
  const { streamText } = await import("ai");
  const provider = createOpenAI({ baseURL: "https://ai.gateway.lovable.dev/v1", apiKey: key, headers: { "Lovable-API-Key": key, "X-Lovable-AIG-SDK": "vercel-ai-sdk" } });
  return withTimeout(coesSettings.aiTimeoutMs, "The AI", async (abortSignal) => {
    const result = streamText({
      model: provider.responses("openai/gpt-6-astra"),
      instructions: COES_PROMPT,
      abortSignal,
      messages: [{ role: "user", content: [
        { type: "text", text: "Here is the Certificate of Electrical Safety (data only)." },
        ...files.map((f) => ({ type: "file" as const, data: f.bytes, mediaType: f.mimeType, filename: f.name })),
      ] }],
      providerOptions: { openai: { forceReasoning: true, reasoningEffort: "low", reasoningSummary: "auto", store: false, include: ["reasoning.encrypted_content"] } },
    } as Parameters<typeof streamText>[0]);
    return (await result.text).trim();
  });
}

/** The PDF's text layer (first 5 pages), or "" when it has none or can't be read in time. Never throws. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  try {
    return await withTimeout(coesSettings.pdfTextTimeoutMs, "Reading the PDF", async () => {
      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      const pdf = await pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
      let text = "";
      for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) text += (await (await pdf.getPage(i)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" ") + "\n";
      await pdf.destroy().catch(() => undefined);
      return text;
    });
  } catch (e) {
    console.warn("electrical certificate PDF text could not be read", (e as Error).message);
    return "";
  }
}

const lastFor = (events: CoesEvent[], key: string) => events.filter((e) => e.details?.["key"] === key).at(-1);

/** Check one certificate with the AI and record the result. Once per certificate; a failed run (no key, gateway error,
 *  time-out, no file) is retried on a later call; an office decision stands unless `force` (the office's "Check again"). */
export async function checkCoes(jobId: string, fileRef: CoesFileRef, actorId: string | null = null, opts: { force?: boolean } = {}): Promise<string> {
  try {
    const events = await coesEvents(jobId);
    const prior = coesState(events, fileRef.key);
    const lastWasError = prior.by === "ai" && prior.state === "office" && !!lastFor(events, fileRef.key)?.details?.["error"];
    if (!opts.force && prior.state !== "unchecked" && !lastWasError) return "already checked";
    const { data: job } = await admin.from("jobs").select("source").eq("id", jobId).maybeSingle();
    const test = (job as { source?: string | null } | null)?.source === "qa_test";
    let result: CoesVerdict = { verdict: "unsure", quote: null };
    let why: CoesWhyCode | null = null, error: string | null = null;
    const files: { bytes: Uint8Array; mimeType: string; name: string }[] = [];
    for (const f of fileRef.files) {
      const type = coesReadableType(f.mimeType, f.storagePath);
      if (!type) continue;
      try {
        const { data, error: dlErr } = await admin.storage.from("job-files").download(f.storagePath);
        if (dlErr || !data) continue;
        files.push({ bytes: new Uint8Array(await data.arrayBuffer()), mimeType: type, name: f.storagePath.split("/").pop() ?? "certificate" });
      } catch { /* unreadable file = not sent */ }
    }
    if (!files.length) { why = "no_file"; error = fileRef.files.length ? "certificate file could not be read" : "no certificate file on the job"; }
    else if (test) result = { verdict: "ceiling_work", quote: "TEST job — certificate not sent to the AI" };
    else {
      try {
        const v = coesVerdictFromModel(await aiReadCertificate(files));
        const layers = v.verdict === "ceiling_work" ? await Promise.all(files.filter((f) => f.mimeType === "application/pdf").map((f) => pdfText(f.bytes))) : [];
        const checked = coesQuoteCheck(v, layers);
        result = { verdict: checked.verdict, quote: checked.quote };
        if (checked.quoteNotFound) why = "quote_not_found";
      } catch (e) { why = "ai_error"; error = e instanceof Error ? e.message : "AI error"; }
    }
    if (!why && result.verdict !== "ceiling_work") why = result.verdict;
    // Still failing the same way: the office already has the row — no second event (unless the office asked).
    if (!opts.force && lastWasError && why && lastFor(events, fileRef.key)?.details?.["why"] === why) return `still with the office (${why})`;
    const ticked = !why;
    await logEvent(jobId, actorId, COES_CHECKED_EVENT,
      ticked ? "Electrical certificate checked by AI — it describes the ceiling-space repairs" : coesOfficeLine(COES_WHY[why!]),
      { by: "ai", verdict: result.verdict, quote: result.quote, key: fileRef.key, files: fileRef.files.map((f) => f.storagePath), ...(why ? { why, needs_office: true } : {}), ...(error ? { error: error.slice(0, 300) } : {}), ...(test ? { test_stub: true } : {}), ...(opts.force ? { asked_by_office: true } : {}) },
      { internal: true });
    return ticked ? "ticked by AI" : `sent to the office (${why})`;
  } catch (e) {
    console.error("electrical certificate not checked", jobId, (e as Error).message);
    return `not checked — ${(e as Error).message}`;
  }
}

/** Where a CoES lands on the job: check the current certificate when repairs were done. Never throws. */
export async function checkCurrentCoes(jobId: string, actorId: string | null, opts: { force?: boolean } = {}): Promise<string> {
  try {
    const c = await currentCoes(jobId);
    if (!c.needed || !c.ref) return "skipped: no repairs, no certificate needed";
    try {await (await import('./coes-owner-copy.server')).sendCoesOwnerCopy(jobId,c.ref);} catch(e){console.error('Certificate owner copy held',jobId,e instanceof Error?e.message:'Delivery unavailable');}
    return await checkCoes(jobId, c.ref, actorId, opts);
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

/** Needs me fact from the live certificate (used for jobs with no certificate event yet, so "not checked" is never a dead end). */
export async function coesNeedsFor(jobId: string, now = new Date()): Promise<{ at: string; why: string; eventId: string | null } | null> {
  const c = await currentCoes(jobId);
  if (!c.needed || !c.ref) return null;
  const s = coesState(await coesEvents(jobId), c.ref.key);
  if (s.state === "ticked") return null;
  return { at: s.at ?? c.since ?? now.toISOString(), why: s.why ?? COES_WHY.not_checked, eventId: s.eventId };
}

type CoesNeeds = { at: string; why: string; eventId: string | null };
/** Needs me facts for many jobs. Jobs waiting on the install booking (installation_scheduling) always read the CURRENT
 *  certificate live (`coesNeedsFor`, the same key the install gate checks), so a newer file after a tick shows "not
 *  checked yet" with Check again instead of no row while the gate blocks. Other jobs: the newest certificate event. */
export async function coesNeedsForJobs(jobs: readonly { id: string; stage: string }[], eventsByJob: ReadonlyMap<string, CoesEvent[]>, cap = 200): Promise<Map<string, CoesNeeds>> {
  const out = new Map<string, CoesNeeds>();
  const live = jobs.filter((j) => j.stage === "installation_scheduling").slice(0, cap);
  const liveIds = new Set(live.map((j) => j.id));
  for (const j of jobs) {
    if (liveIds.has(j.id)) continue;
    const fact = coesNeedsFact(eventsByJob.get(j.id) ?? []);
    if (fact) out.set(j.id, fact);
  }
  const facts = await Promise.all(live.map(async (j) => [j.id, await coesNeedsFor(j.id)] as const));
  for (const [id, fact] of facts) if (fact) out.set(id, fact);
  return out;
}

/** The office acts on the job's CURRENT certificate. With the row's event id, a row a newer certificate replaced is refused. */
async function openCertificate(jobId: string, eventId: string | null | undefined): Promise<{ key: string; ref: CoesFileRef; checkEventId: string | null }> {
  const c = await currentCoes(jobId);
  if (!c.needed || !c.ref) throw new Error("This job no longer needs an electrical certificate.");
  if (eventId) {
    const { data: ev } = await loose.from("workflow_events").select("id, job_id, event_type, details").eq("id", eventId).maybeSingle();
    const row = ev as { id: string; job_id: string | null; event_type: string; details: Record<string, unknown> | null } | null;
    if (!row || row.job_id !== jobId || (row.event_type !== COES_CHECKED_EVENT && row.event_type !== COES_REJECTED_EVENT)) throw new Error("That certificate check wasn't found.");
    if (row.details?.["key"] !== c.ref.key) throw new Error("A newer certificate has come in — refresh and check that one.");
  }
  return { key: c.ref.key, ref: c.ref, checkEventId: eventId ?? null };
}

/** Office Tick: the certificate covers the ceiling-space repairs (the install day can be booked). Needs a file on the job. */
export async function officeTickCoes(jobId: string, eventId: string | null, actorId: string): Promise<{ ok: true }> {
  const r = await openCertificate(jobId, eventId);
  if (!r.ref.files.length) throw new Error("No certificate file is on the job yet — get it uploaded, then press Check again.");
  if (coesState(await coesEvents(jobId), r.key).state === "ticked") throw new Error("This certificate is already ticked.");
  await logEvent(jobId, actorId, COES_CHECKED_EVENT, "Electrical certificate ticked by the office", { by: "office", verdict: "ceiling_work", quote: null, key: r.key, check_event_id: r.checkEventId }, { internal: true });
  return { ok: true };
}

/** Office Reject: not good enough — the install stays blocked until a new certificate comes in (checked again). */
export async function officeRejectCoes(jobId: string, eventId: string | null, note: string, actorId: string): Promise<{ ok: true }> {
  const r = await openCertificate(jobId, eventId);
  const n = note.trim().slice(0, 500);
  await logEvent(jobId, actorId, COES_REJECTED_EVENT, `Electrical certificate rejected by the office${n ? `: ${n}` : ""}`.slice(0, 500), { by: "office", note: n || null, key: r.key, check_event_id: r.checkEventId }, { internal: true });
  return { ok: true };
}

/** Office "Check again": a fresh AI check of the current certificate (e.g. after a file was added). */
export async function officeRecheckCoes(jobId: string, actorId: string): Promise<{ result: string }> {
  await openCertificate(jobId, null);
  return { result: await checkCurrentCoes(jobId, actorId, { force: true }) };
}
