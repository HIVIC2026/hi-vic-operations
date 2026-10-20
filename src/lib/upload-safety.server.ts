// Checks the first bytes of a stored upload against its allowed type (security review A).
// Deletes it ONLY when its content was actually read and is positively the wrong type. If the file can't be
// inspected right now (signing/network/storage hiccup), it is kept and a retryable error is thrown.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { signatureMatches } from "./upload-safety.core";

export const BAD_FILE_MESSAGE = "That file type isn't accepted. Please upload a PDF, photo (JPG, PNG, WEBP, HEIC), video (MP4, MOV), Word or Excel file.";
export const CHECK_UNAVAILABLE_MESSAGE = "We couldn't check that file just now. It has been kept — please try again.";

export class UploadCheckUnavailableError extends Error {
  constructor() { super(CHECK_UNAVAILABLE_MESSAGE); this.name = "UploadCheckUnavailableError"; }
}

export async function verifyStoredUpload(bucket: string, path: string, mime: string): Promise<void> {
  const { data: s, error } = await admin.storage.from(bucket).createSignedUrl(path, 60);
  if (error || !s?.signedUrl) throw new UploadCheckUnavailableError();
  const r = await fetch(s.signedUrl, { headers: { Range: "bytes=0-1023" } }).catch(() => null);
  if (!r || !(r.ok || r.status === 206)) throw new UploadCheckUnavailableError();
  let head: Uint8Array;
  try { head = new Uint8Array(await r.arrayBuffer()).subarray(0, 1024); } catch { throw new UploadCheckUnavailableError(); }
  if (!signatureMatches(head, mime)) {
    await admin.storage.from(bucket).remove([path]).catch(() => null);
    throw new Error(BAD_FILE_MESSAGE);
  }
}
