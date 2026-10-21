const purpose = "save_spot_reminder:v1";
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const decode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), c => c.charCodeAt(0));
async function key(secret: string) {
  if (secret.length < 32) throw new Error("Secure save link is not configured");
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
/** Authenticated encrypted, save-only credential: no customer or estimate token visible in URL. */
export async function createOneTapCredential(token: string, expiresAt: number, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), new TextEncoder().encode(JSON.stringify({ purpose, token, expiresAt })));
  return encode(new Uint8Array([...iv, ...new Uint8Array(cipher)]));
}
export async function verifyOneTapCredential(credential: string, secret: string, now = Date.now()): Promise<string | null> {
  try {
    if (!/^[A-Za-z0-9_-]{80,600}$/.test(credential)) return null;
    const bytes = decode(credential);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0,12) }, await key(secret), bytes.slice(12));
    const data = JSON.parse(new TextDecoder().decode(plain));
    return data.purpose === purpose && typeof data.token === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(data.token) && Number.isFinite(data.expiresAt) && data.expiresAt > now ? data.token : null;
  } catch { return null; }
}