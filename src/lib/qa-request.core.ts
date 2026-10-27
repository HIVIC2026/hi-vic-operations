// A server-only signature, not an email or public form field, authorises preview QA.
export function qaPreviewHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || /^id-preview--[a-z0-9-]+\.lovable\.app$/.test(host);
}
export const qaPerson = (email: string) => /^[^@\s]+@(?:[a-z0-9-]+\.)*hivic-test\.example$/i.test(email);
export async function qaRequestSignature(secret: string, stamp: string, path: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`journey-preview-only\n${stamp}\n${path}`)));
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
export async function verifiedQaRequest(url: string, headers: Headers, secret: string | undefined, now = Date.now()): Promise<boolean> {
  const u = new URL(url);
  const stamp = headers.get("x-hivic-qa-time") ?? "";
  const signature = headers.get("x-hivic-qa-signature") ?? "";
  if (!secret || !qaPreviewHost(u.hostname) || !/^\d{13}$/.test(stamp) || Math.abs(now - Number(stamp)) > 60_000 || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const expected = await qaRequestSignature(secret, stamp, u.pathname);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}