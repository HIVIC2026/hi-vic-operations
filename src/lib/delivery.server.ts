// Base44 delivery bridge adapter (placeholder until Base44 exposes the endpoint). Reads config per call.
import { base44BridgeConfig, type DeliveryAdapter, type DeliveryMessage } from "./delivery.core";

async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Returns null (nothing can be delivered) until BASE44_DELIVERY_URL + BASE44_DELIVERY_SECRET are configured. */
export function configuredDeliveryAdapter(): DeliveryAdapter | null {
  const cfg = base44BridgeConfig(process.env as Record<string, string | undefined>);
  if (!cfg) return null;
  return {
    provider: "base44_bridge",
    async deliver(msg: DeliveryMessage) {
      const body = JSON.stringify({ to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, idempotency_key: msg.idempotencyKey, purpose: msg.purpose });
      const res = await fetch(cfg.url, { method: "POST", headers: { "Content-Type": "application/json", "x-hivic-signature": await hmacHex(cfg.secret, body), "Idempotency-Key": msg.idempotencyKey }, body, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`Base44 delivery bridge returned ${res.status}`);
      const j = (await res.json().catch(() => ({}))) as { message_id?: string };
      return { providerMessageId: j.message_id ?? null };
    },
  };
}
