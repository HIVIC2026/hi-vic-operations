// Decision 336 (Jo 25 Oct 2026: "WHERE IS THE ELECTRICIAN'S SIGNATURE?"): the electrician's ACTUAL signature images captured in
// Mitti — A4 "Electrician signature" (PIESA Part B3) and A5 "Electrician signature" (PIESA Section C) — are downloaded through
// the same Mitti media path as the evidence files, kept with the job (private job-files bucket + a documents row) and recorded
// once per media id as an internal `piesa_signature_saved` event (audit id, media id, the signature's OWN timestamp, path,
// SHA-256). The official Word form / PDF read them back from storage (officialSignatureImages). The PIISA (A3 lead installer)
// image is the one already stored by the start-of-work capture (piisa-prestart.server `storeSignatureImage`).
// Never sends anything; a failure is one internal event and never throws.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { MittiMediaFetch } from "./mitti.server";
import type { OfficialKey } from "./official-forms.core";
import { INSTALLER_SIGNATURE_IMAGE_NOT_AVAILABLE, SIGNATURE_IMAGE_NOT_AVAILABLE, type SignatureInput, type SignatureSlot } from "./official-docx.core";

export const PIESA_SIGNATURE_SAVED_EVENT = "piesa_signature_saved";
export const PIESA_SIGNATURE_FAILED_EVENT = "piesa_signature_image_failed";
/** a4 = the PIESA visit (Part B3), a5 = the electrical fixes form (Section C). */
export type PiesaSignatureRole = "a4" | "a5";
export type StoredPiesaSignature = { role: PiesaSignatureRole; audit_id: string; media_id: string; item_id: string | null; signer_name: string | null; signed_at: string | null; path: string; sha256: string; content_type: string };

const melbourneDate = (iso: string | null | undefined): string | null =>
  iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) : null;

/** Keep one private copy of a Mitti signature image with the job. Idempotent per (audit, media id). Never throws. */
export async function savePiesaSignatureImage(jobId: string, actorId: string | null, role: PiesaSignatureRole, auditId: string, sig: { mediaId: string | null; signedAt: string | null; name: string | null; itemId?: string | null }, fetchMedia: MittiMediaFetch): Promise<StoredPiesaSignature | null> {
  if (!sig.mediaId) return null;
  try {
    const { data: prior } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", PIESA_SIGNATURE_SAVED_EVENT).contains("details", { audit_id: auditId, media_id: sig.mediaId }).limit(1);
    const existing = (prior?.[0]?.details ?? null) as unknown as StoredPiesaSignature | null;
    if (existing?.path) return existing;
    const { bytes, contentType } = await fetchMedia(auditId, sig.mediaId);
    if (!bytes.length) throw new Error("empty signature image");
    const { createHash } = await import("node:crypto");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const ext = contentType.includes("png") ? "png" : contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "img";
    const path = `${jobId}/mitti/piesa-signature/${auditId}-${sig.mediaId}.${ext}`;
    const up = await admin.storage.from("job-files").upload(path, bytes, { contentType, upsert: false });
    if (up.error && !/exists/i.test(up.error.message)) throw new Error(`storage upload failed: ${up.error.message}`);
    const key = `${auditId}:${sig.mediaId}`;
    const { data: ex } = await admin.from("documents").select("id").eq("job_id", jobId).eq("source_system", "mitti").eq("external_id", key).maybeSingle();
    if (!ex) await admin.from("documents").insert({ job_id: jobId, kind: "piesa_evidence", title: role === "a4" ? "PIESA – electrician signature (Mitti A4)" : "PIESA Section C – electrician signature (Mitti A5)", storage_path: path, mime_type: contentType, uploaded_by: actorId, source_system: "mitti", external_id: key, original_name: `signature-${sig.mediaId}.${ext}`, size_bytes: bytes.length });
    const rec: StoredPiesaSignature = { role, audit_id: auditId, media_id: sig.mediaId, item_id: sig.itemId ?? null, signer_name: sig.name, signed_at: sig.signedAt, path, sha256, content_type: contentType };
    await logEvent(jobId, actorId, PIESA_SIGNATURE_SAVED_EVENT, role === "a4" ? "Electrician's PIESA signature image kept with the job (decision 336)" : "Electrician's Section C signature image kept with the job (decision 336)", rec as unknown as Record<string, unknown>, { internal: true });
    return rec;
  } catch (e) {
    await logEvent(jobId, actorId, PIESA_SIGNATURE_FAILED_EVENT, `${SIGNATURE_IMAGE_NOT_AVAILABLE} (${role.toUpperCase()}) – sync again to retry`, { role, audit_id: auditId, media_id: sig.mediaId, reason: e instanceof Error ? e.message : "error" }, { internal: true }).catch(() => undefined);
    return null;
  }
}

/** The latest stored signature record for a role (the A4 one for the job's current PIESA audit when known). */
export async function latestPiesaSignature(jobId: string, role: PiesaSignatureRole): Promise<StoredPiesaSignature | null> {
  const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", PIESA_SIGNATURE_SAVED_EVENT).order("created_at", { ascending: false }).limit(20);
  const recs = (data ?? []).map((r) => r.details as unknown as StoredPiesaSignature).filter((d) => d?.role === role && !!d.path);
  if (role === "a4" && recs.length) {
    const { data: a } = await admin.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle();
    const current = a?.external_mitti_id ? recs.find((r) => r.audit_id === a.external_mitti_id) : null;
    return current ?? recs[0]!;
  }
  return recs[0] ?? null;
}

async function download(path: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from("job-files").download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export type OfficialSignatures = { signatures: Partial<Record<SignatureSlot, SignatureInput>>; flags: string[]; facts: { slot: SignatureSlot; media_id: string | null; signed_at: string | null; path: string | null }[] };

/**
 * The signature images for the official Word form / PDF of `key`, read from the job's private files. `answers` = the official
 * answers being filled (Section C is only looked up when it is filled). A missing image is a flag
 * ("Electrician signature image not available") and the box keeps the typed name. PIISA: the A3 lead installer image stored
 * at the start-of-work capture (`prestart`, else the job's latest one).
 */
export async function officialSignatureImages(jobId: string, key: OfficialKey, answers: Record<string, unknown>, prestart?: { image_path: string; content_type: string; signed_at: string } | null): Promise<OfficialSignatures> {
  const out: OfficialSignatures = { signatures: {}, flags: [], facts: [] };
  const txt = (v: unknown) => (v == null ? "" : String(v)).trim();
  const ddmm = (d: string) => d.replace(/^(\d{4})-(\d{2})-(\d{2})$/, "$3/$2/$1");
  if (key === "piesa") {
    const b3 = await latestPiesaSignature(jobId, "a4").catch(() => null);
    const bytes = b3 ? await download(b3.path).catch(() => null) : null;
    const signedOn = melbourneDate(b3?.signed_at) ?? txt(answers["inspectionDate"]);
    const name = txt(answers["b3.name"]);
    out.signatures["b3.signature"] = { images: bytes ? [{ bytes, contentType: b3!.content_type, signedOn }] : [], fallbackText: name ? `${name} (signed in Mitti${signedOn ? ` on ${ddmm(signedOn)}` : ""}; ${SIGNATURE_IMAGE_NOT_AVAILABLE.toLowerCase()})` : null };
    if (!bytes) out.flags.push(`${SIGNATURE_IMAGE_NOT_AVAILABLE} (Part B3 — the typed name is shown instead).`);
    out.facts.push({ slot: "b3.signature", media_id: b3?.media_id ?? null, signed_at: b3?.signed_at ?? null, path: b3?.path ?? null });
    if (txt(answers["c.signature"])) {
      const c = await latestPiesaSignature(jobId, "a5").catch(() => null);
      const cb = c ? await download(c.path).catch(() => null) : null;
      out.signatures["c.signature"] = { images: cb ? [{ bytes: cb, contentType: c!.content_type, signedOn: melbourneDate(c!.signed_at) ?? txt(answers["c.certDate"]) }] : [] };
      if (!cb) out.flags.push(`${SIGNATURE_IMAGE_NOT_AVAILABLE} (Section C — the typed name is shown instead).`);
      out.facts.push({ slot: "c.signature", media_id: c?.media_id ?? null, signed_at: c?.signed_at ?? null, path: c?.path ?? null });
    }
    return out;
  }
  let pre = prestart ?? null;
  if (!pre) {
    const { data } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "piisa_prestart_captured").order("created_at", { ascending: false }).limit(1);
    const d = data?.[0]?.details as { signature_image?: { image_path: string; content_type: string; signed_at: string } } | undefined;
    pre = d?.signature_image ?? null;
  }
  const bytes = pre ? await download(pre.image_path).catch(() => null) : null;
  out.signatures["p8.signature"] = { images: bytes ? [{ bytes, contentType: pre!.content_type, signedOn: melbourneDate(pre!.signed_at) ?? txt(answers["p8.date"]) }] : [] };
  if (!bytes) out.flags.push(`${INSTALLER_SIGNATURE_IMAGE_NOT_AVAILABLE} (Part 8 — the typed name is shown instead).`);
  out.facts.push({ slot: "p8.signature", media_id: null, signed_at: pre?.signed_at ?? null, path: pre?.image_path ?? null });
  return out;
}
