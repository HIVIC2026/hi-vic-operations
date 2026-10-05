// Uploaded documents are served from OUR app domain (/api/files/...), never from the storage domain,
// which browsers such as Edge block as third-party tracking. Callers keep their existing permission
// checks; this only swaps the storage-signed link for a short-lived, HMAC-signed app link.
import { createHmac, timingSafeEqual } from "crypto";

export const FILE_BUCKETS = ["job-files", "partner-files", "official-form-copies"] as const;
type Bucket = (typeof FILE_BUCKETS)[number];

function key(): string {
  const s = process.env["ONBOARDING_FP_SECRET"];
  if (!s) throw new Error("File links are not configured.");
  return createHmac("sha256", s).update("hivic-file-link-v1").digest("hex");
}
const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (body: string) => createHmac("sha256", key()).update(body).digest("base64url");

/** Drop-in for storage.createSignedUrl: returns `{ data: { signedUrl }, error }` with an app-relative link. */
export async function signFile(bucket: string, path: string, ttlSeconds: number): Promise<{ data: { signedUrl: string } | null; error: Error | null }> {
  if (!(FILE_BUCKETS as readonly string[]).includes(bucket) || !path) return { data: null, error: new Error("File not available.") };
  const body = b64(JSON.stringify({ b: bucket, p: path, e: Math.floor(Date.now() / 1000) + ttlSeconds }));
  const name = encodeURIComponent((path.split("/").pop() || "file").replace(/[^\w.\-]+/g, "_"));
  return { data: { signedUrl: `/api/files/${body}.${sign(body)}/${name}` }, error: null };
}

export function verifyFileToken(token: string): { bucket: Bucket; path: string } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(sign(body)), got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(body, "base64url").toString()) as { b: Bucket; p: string; e: number };
    if (!(FILE_BUCKETS as readonly string[]).includes(t.b) || t.e < Date.now() / 1000) return null;
    return { bucket: t.b, path: t.p };
  } catch { return null; }
}
