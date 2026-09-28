// Base44 intake persistence: immutable contact consent + private media copy. Pure rules in enquiry.core.ts.
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  MEDIA_FETCH_TIMEOUT_MS, MEDIA_MAX_TOTAL_BYTES, maxBytesFor, mediaStoragePath, planContactConsent, planMediaImport, sanitizeFilename, sha256Hex,
  type Base44Media, type Base44Snapshots,
} from "./enquiry.core";

const BUCKET = "job-files";

/** Insert-once consent record (unique job/source/consent_key). Retries with identical consent are no-ops. */
export async function recordContactConsent(jobId: string, ownerId: string, input: Base44Snapshots & { source_reference?: string | null; external_enquiry_id?: string | null }) {
  const plan = planContactConsent(input);
  const { data: existing } = await admin.from("owner_contact_consents").select("id").eq("job_id", jobId).eq("source", "base44").eq("consent_key", plan.consent_key).maybeSingle();
  if (existing) return { created: false, status: plan.consent_status };
  const sha256 = await sha256Hex(JSON.stringify(plan.snapshot));
  const { externalContactPermitted, ...row } = plan;
  const { error } = await admin.from("owner_contact_consents").insert({ ...row, snapshot: row.snapshot as Json, job_id: jobId, owner_id: ownerId, source: "base44", sha256 });
  if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
  await logEvent(jobId, null, "contact_consent_recorded",
    externalContactPermitted ? `Contact consent granted on website (${plan.consent_version ?? "no version"})` : "Contact consent missing — no external contact permitted until consent exists",
    { status: plan.consent_status, version: plan.consent_version, consented_at: plan.consented_at, sha256 });
  return { created: true, status: plan.consent_status };
}

export type FetchLike = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

/** Copies each Base44 file into private storage exactly once (job + base44 + source_id). Never throws per file. */
export async function importBase44Media(jobId: string, media: readonly Base44Media[], fetchImpl: FetchLike = fetch) {
  if (!media.length) return { copied: 0, skipped: 0, failed: 0 };
  const { data: docs } = await admin.from("documents").select("external_id").eq("job_id", jobId).eq("source_system", "base44");
  const plan = planMediaImport(media, new Set((docs ?? []).map((d) => d.external_id!).filter(Boolean)));
  const failures: { source_id: string; reason: string }[] = [...plan.rejected];
  let total = 0, copied = 0;
  for (const m of plan.toCopy) {
    try {
      const res = await fetchImpl(m.signed_url, { signal: AbortSignal.timeout(MEDIA_FETCH_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const limit = maxBytesFor(m.mime_type);
      const declared = Number(res.headers.get("content-length") ?? 0);
      if (declared > limit) throw new Error("file too large");
      const buf = await res.arrayBuffer();
      if (buf.byteLength > limit) throw new Error("file too large");
      if (total + buf.byteLength > MEDIA_MAX_TOTAL_BYTES) throw new Error("total upload limit reached");
      const path = mediaStoragePath(jobId, m.source_id, m.name);
      const up = await admin.storage.from(BUCKET).upload(path, buf, { contentType: m.mime_type, upsert: true });
      if (up.error) throw new Error(`storage: ${up.error.message}`);
      const { error } = await admin.from("documents").insert({
        job_id: jobId, kind: "intake_media", title: `Website upload: ${sanitizeFilename(m.name)}`, storage_path: path, mime_type: m.mime_type,
        source_system: "base44", external_id: m.source_id, original_name: m.name.slice(0, 300), size_bytes: buf.byteLength,
      });
      if (error && !/duplicate/i.test(error.message)) throw new Error(error.message);
      total += buf.byteLength; copied++;
    } catch (e) {
      failures.push({ source_id: m.source_id, reason: (e as Error).name === "TimeoutError" ? "download timed out" : (e as Error).message });
    }
  }
  if (copied) await logEvent(jobId, null, "base44_media_copied", `${copied} website photo/video file(s) stored privately`, { copied, skipped: plan.skipped.length });
  if (failures.length) {
    // Attention item: shown in the Intake summary; the next Base44 sync retries anything not yet stored.
    await logEvent(jobId, null, "base44_media_copy_failed", `${failures.length} website file(s) could not be copied — needs retry`, { failures } as unknown as Record<string, unknown>);
    await admin.from("external_sync_logs").insert({ system: "base44", direction: "inbound", entity_type: "media", entity_id: jobId, status: "error", error: failures.map((f) => `${f.source_id}: ${f.reason}`).join("; ").slice(0, 2000) });
  }
  return { copied, skipped: plan.skipped.length, failed: failures.length };
}
