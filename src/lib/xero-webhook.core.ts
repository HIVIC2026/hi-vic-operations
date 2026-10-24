// Xero webhook (decision 139): pure signature check + payload parsing. No database, no Xero calls.
// Xero signs the RAW request body with HMAC-SHA256 using the app's webhook key and sends it base64 in `x-xero-signature`.
// An "intent to receive" probe must get 200 only when the signature matches, 401 otherwise (empty body both ways).

export const XERO_SIGNATURE_HEADER = "x-xero-signature";

async function hmacBase64(key: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(body));
  let bin = "";
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** True only when the key is configured, a signature header is present and it matches the raw body. Fails closed. */
export async function verifyXeroWebhookSignature(rawBody: string, signature: string | null | undefined, key: string | null | undefined): Promise<boolean> {
  if (!key || !signature) return false;
  const expected = await hmacBase64(key, rawBody);
  return constantTimeEqual(expected.trim(), signature.trim());
}

export type XeroWebhookEvent = { resourceId: string; eventCategory: string; eventType: string; tenantId: string | null };

/** INVOICE events (CREATE/UPDATE) with a resource id. Anything else is ignored. Unreadable JSON = no events. */
export function parseXeroWebhookEvents(rawBody: string): XeroWebhookEvent[] {
  let json: unknown;
  try { json = JSON.parse(rawBody); } catch { return []; }
  const events = (json as { events?: unknown })?.events;
  if (!Array.isArray(events)) return [];
  const out: XeroWebhookEvent[] = [];
  for (const e of events as Record<string, unknown>[]) {
    const resourceId = typeof e?.["resourceId"] === "string" ? (e["resourceId"] as string) : null;
    const eventCategory = typeof e?.["eventCategory"] === "string" ? (e["eventCategory"] as string) : "";
    const eventType = typeof e?.["eventType"] === "string" ? (e["eventType"] as string) : "";
    if (!resourceId || eventCategory !== "INVOICE") continue;
    out.push({ resourceId, eventCategory, eventType, tenantId: typeof e["tenantId"] === "string" ? (e["tenantId"] as string) : null });
  }
  return out;
}

/** Distinct Xero invoice ids to re-sync for a webhook delivery. */
export const webhookInvoiceIds = (events: XeroWebhookEvent[]) => [...new Set(events.map((e) => e.resourceId))];
