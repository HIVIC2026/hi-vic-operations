// Provider-independent customer email delivery contract. Pure. No provider is connected.
export type DeliveryMessage = { to: string; subject: string; html: string; text: string; idempotencyKey: string; purpose: string };
export interface DeliveryAdapter { provider: string; deliver(msg: DeliveryMessage): Promise<{ providerMessageId: string | null }>; }

/** The provider definitely refused the message (it answered with an error). Only this kind of failure may be retried. */
export class DeliveryRejectedError extends Error { constructor(m: string) { super(m); this.name = "DeliveryRejectedError"; } }
/** Status after a failed delivery attempt. A timeout/network error means the provider MAY have accepted it:
 *  record "delivered_unrecorded" (sent-unknown) so nothing ever retries it automatically. */
export function statusAfterDeliveryError(e: unknown, delivered = false): "failed" | "delivered_unrecorded" {
  return !delivered && e instanceof DeliveryRejectedError ? "failed" : "delivered_unrecorded";
}

export type Base44BridgeConfig = { url: string; secret: string };
export type DeliverySettingsRow = { provider?: string | null; endpoint_url: string | null; hmac_secret: string | null; enabled: boolean | null };

/** Bridge is usable only when the settings row is enabled AND has an https endpoint AND a >=32-char signing secret. */
export function base44BridgeConfig(row: DeliverySettingsRow | null | undefined): Base44BridgeConfig | null {
  if (!row || row.enabled !== true) return null;
  if ((row.provider ?? "base44_bridge") !== "base44_bridge") return null;
  const url = row.endpoint_url?.trim();
  const secret = row.hmac_secret?.trim();
  if (!url || !secret || secret.length < 32) return null;
  try { if (new URL(url).protocol !== "https:") return null; } catch { return null; }
  return { url, secret };
}

/** HMAC SHA-256 hex of the exact JSON body — header x-hivic-signature. Contract unchanged. */
export async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bridgeBody(msg: DeliveryMessage) {
  return JSON.stringify({ to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, idempotency_key: msg.idempotencyKey, purpose: msg.purpose });
}

/** Adapter over a validated config. fetchImpl injectable for tests. Never logs or returns the secret. */
export function bridgeAdapter(cfg: Base44BridgeConfig, fetchImpl: typeof fetch = fetch): DeliveryAdapter {
  return {
    provider: "base44_bridge",
    async deliver(msg: DeliveryMessage) {
      const body = bridgeBody(msg);
      const res = await fetchImpl(cfg.url, { method: "POST", headers: { "Content-Type": "application/json", "x-hivic-signature": await hmacHex(cfg.secret, body), "Idempotency-Key": msg.idempotencyKey }, body, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new DeliveryRejectedError(`Base44 delivery bridge returned ${res.status}`);
      const j = (await res.json().catch(() => ({}))) as { message_id?: string };
      return { providerMessageId: j.message_id ?? null };
    },
  };
}
