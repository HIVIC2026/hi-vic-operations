// Checks the first bytes of a stored upload against its allowed type (security review A). Deletes it on mismatch.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { signatureMatches } from "./upload-safety.core";

export const BAD_FILE_MESSAGE = "That file type isn't accepted. Please upload a PDF, photo (JPG, PNG, WEBP, HEIC), video (MP4, MOV), Word or Excel file.";

export async function verifyStoredUpload(bucket: string, path: string, mime: string): Promise<void> {
  const { data: s } = await admin.storage.from(bucket).createSignedUrl(path, 60);
  let head: Uint8Array | null = null;
  if (s?.signedUrl) {
    const r = await fetch(s.signedUrl, { headers: { Range: "bytes=0-1023" } }).catch(() => null);
    if (r && (r.ok || r.status === 206)) head = new Uint8Array(await r.arrayBuffer()).subarray(0, 1024);
  }
  if (!head || !signatureMatches(head, mime)) {
    await admin.storage.from(bucket).remove([path]).catch(() => null);
    throw new Error(BAD_FILE_MESSAGE);
  }
}
