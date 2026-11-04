// New job flow Part 6, Task 5: the Certificate of Electrical Safety uploaded from the electrician's link OR by the installer
// office. ONE path, ONE record: a `documents` row (kind piesa_evidence, FIXES_COES_DOC_TITLE, source_system "upload") and a
// private job-files object under `{jobId}/coes/`. `currentCoes` (coes-check.server) reads these rows, so the electrician's
// link, the office's Next step and the Part 9 install gate all see the same certificate.
// - Only a PDF or a photo (JPEG, PNG, HEIC), up to 15 MB; the file's own first bytes decide the type, not its name.
// - Idempotent: the same file sent again (retry, double press, the other side) is the same document; it is recorded and
//   checked once. Two different files make two documents in one ref.
// - Refused when the job needs no certificate (no upgrades). The owner copy is NOT sent here: it follows the existing
//   tick / office-approval path (checkCurrentCoes, officeTickCoes), so the owner gets it before the install as today.
import { createHash, randomUUID } from "node:crypto";
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

export const COES_UPLOADED_EVENT = "coes_uploaded";
export const COES_MAX_BYTES = 15 * 1024 * 1024;
// DRAFT wording (not from the plan's approved text, except the first two which the plan gives): Jo to approve.
export const COES_BAD_TYPE = "Upload a photo or PDF of the certificate."; // DRAFT
export const COES_NOT_NEEDED = "No certificate is needed for this job."; // DRAFT
export const COES_TOO_BIG = "That file is too big. Upload one under 15 MB."; // DRAFT
export const COES_NOT_SAVED = "We couldn't save that file. Try again."; // DRAFT

/** A refusal with plain wording for a person. */
export class CoesUploadError extends Error {}

export type CoesUploadBy = { kind: "electrician_link"; workerId: string } | { kind: "installer_office"; userId: string };
export type CoesFile = { name: string; type: string; bytes: Uint8Array };

type Kind = { mime: string; ext: string };
const ascii = (b: Uint8Array, from: number, s: string) => s.split("").every((ch, i) => b[from + i] === ch.charCodeAt(0));
/** What the file really is, from its first bytes; it must also agree with the type the browser said (or the name's ending). */
export function coesFileKind(f: CoesFile): Kind | null {
  const b = f.bytes;
  const claimed = f.type.split(";")[0]!.trim().toLowerCase();
  const ext = (f.name.toLowerCase().split(".").pop() ?? "");
  const is = (mimes: string[], exts: string[]) => mimes.includes(claimed) || ((!claimed || claimed === "application/octet-stream") && exts.includes(ext));
  if (b.length >= 5 && ascii(b, 0, "%PDF-") && is(["application/pdf"], ["pdf"])) return { mime: "application/pdf", ext: "pdf" };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff && is(["image/jpeg", "image/jpg", "image/pjpeg"], ["jpg", "jpeg"])) return { mime: "image/jpeg", ext: "jpg" };
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, "PNG\r\n") && b[6] === 0x1a && b[7] === 0x0a && is(["image/png"], ["png"])) return { mime: "image/png", ext: "png" };
  if (b.length >= 12 && ascii(b, 4, "ftyp") && ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"].some((brand) => ascii(b, 8, brand)) && is(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"], ["heic", "heif"])) return { mime: "image/heic", ext: "heic" };
  return null;
}

/** One upload at a time per job inside this process; the same-file check below covers a second process. */
const queues = new Map<string, Promise<unknown>>();
async function perJob<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(jobId) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(jobId, tail);
  try { return await run; } finally { if (queues.get(jobId) === tail) queues.delete(jobId); }
}

export async function saveUploadedCoes(jobId: string, file: CoesFile, by: CoesUploadBy): Promise<{ ok: true; documentId: string }> {
  if (file.bytes.length > COES_MAX_BYTES) throw new CoesUploadError(COES_TOO_BIG);
  const kind = coesFileKind(file);
  if (!kind) throw new CoesUploadError(COES_BAD_TYPE);
  const { currentCoes, checkCoes } = await import("./coes-check.server");
  const { FIXES_COES_DOC_KIND, FIXES_COES_DOC_TITLE } = await import("./fixes-day.core");

  return perJob(jobId, async () => {
    if (!(await currentCoes(jobId)).needed) throw new CoesUploadError(COES_NOT_NEEDED);
    const sha = createHash("sha256").update(file.bytes).digest("hex");
    const externalId = `upload:${sha}`;
    const { data: ex, error: exErr } = await admin.from("documents").select("id").eq("job_id", jobId).eq("source_system", "upload").eq("external_id", externalId).eq("title", FIXES_COES_DOC_TITLE).limit(1).maybeSingle();
    if (exErr) { console.error("Certificate upload could not read documents", exErr.message); throw new CoesUploadError(COES_NOT_SAVED); }
    if (ex) return { ok: true as const, documentId: String((ex as { id: string }).id) };

    const path = `${jobId}/coes/${sha.slice(0, 32)}.${kind.ext}`;
    const up = await admin.storage.from("job-files").upload(path, file.bytes, { contentType: kind.mime, upsert: false });
    if (up.error && !/exists/i.test(up.error.message)) { console.error("Certificate upload not stored", up.error.message); throw new CoesUploadError(COES_NOT_SAVED); }
    const id = randomUUID();
    const ins = await admin.from("documents").insert({
      id, job_id: jobId, kind: FIXES_COES_DOC_KIND, title: FIXES_COES_DOC_TITLE, storage_path: path, mime_type: kind.mime, source_system: "upload", external_id: externalId,
      original_name: file.name.slice(0, 200) || `certificate.${kind.ext}`, size_bytes: file.bytes.length, uploaded_by: by.kind === "installer_office" ? by.userId : null,
    });
    if (ins.error) { console.error("Certificate upload not recorded", ins.error.message); throw new CoesUploadError(COES_NOT_SAVED); }

    const { logEvent } = await import("./workflow.server");
    const who = by.kind === "electrician_link" ? { worker_id: by.workerId } : { user_id: by.userId };
    await logEvent(jobId, by.kind === "installer_office" ? by.userId : null, COES_UPLOADED_EVENT, "Certificate of Electrical Safety uploaded", { by: by.kind, ...who, document_id: id, path, mime_type: kind.mime, size_bytes: file.bytes.length }, { internal: true })
      .catch((e) => console.error("Certificate upload not logged", (e as Error).message));

    // The certificate is now a new key: one AI check per key (checkCoes records once and never throws). The owner copy
    // follows the existing tick / office-approval path, not this one.
    const c = await currentCoes(jobId);
    if (c.ref) await checkCoes(jobId, c.ref, by.kind === "installer_office" ? by.userId : null);
    return { ok: true as const, documentId: id };
  });
}
