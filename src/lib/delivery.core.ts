// Provider-independent customer email delivery contract. Pure. No provider is connected.
export type DeliveryMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  purpose: string;
};
export interface DeliveryAdapter {
  provider: string;
  deliver(msg: DeliveryMessage): Promise<{ providerMessageId: string | null }>;
}

/** The provider definitely refused the message (it answered with an error). Only this kind of failure may be retried. */
export class DeliveryRejectedError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "DeliveryRejectedError";
  }
}
/** Status after a failed delivery attempt. A timeout/network error means the provider MAY have accepted it:
 *  record "delivered_unrecorded" (sent-unknown) so nothing ever retries it automatically. */
export function statusAfterDeliveryError(
  e: unknown,
  delivered = false,
): "failed" | "delivered_unrecorded" {
  return !delivered && e instanceof DeliveryRejectedError ? "failed" : "delivered_unrecorded";
}

export type Base44BridgeConfig = { url: string; secret: string };
export type DeliverySettingsRow = {
  provider?: string | null;
  endpoint_url: string | null;
  hmac_secret: string | null;
  enabled: boolean | null;
};

/** Bridge is usable only when the settings row is enabled AND has an https endpoint AND a >=32-char signing secret. */
export function base44BridgeConfig(
  row: DeliverySettingsRow | null | undefined,
): Base44BridgeConfig | null {
  if (!row || row.enabled !== true) return null;
  if ((row.provider ?? "base44_bridge") !== "base44_bridge") return null;
  const url = row.endpoint_url?.trim();
  const secret = row.hmac_secret?.trim();
  if (!url || !secret || secret.length < 32) return null;
  try {
    if (new URL(url).protocol !== "https:") return null;
  } catch {
    return null;
  }
  return { url, secret };
}

/** HMAC SHA-256 hex of the exact JSON body — header x-hivic-signature. Contract unchanged. */
export async function hmacHex(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function bridgeBody(msg: DeliveryMessage) {
  return JSON.stringify({
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
    idempotency_key: msg.idempotencyKey,
    purpose: msg.purpose,
  });
}

/** Keep rejection reasons, not echoed credentials, recipient details or message content. */
export function bridgeRejectionReason(raw: string, sensitive: string[]): string {
  let reason = raw;
  try {
    const value: unknown = JSON.parse(raw);
    const parts: string[] = [];
    const collect = (v: unknown, depth: number): void => {
      if (depth > 3) return;
      if (typeof v === "string") parts.push(v);
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        const fields = v as Record<string, unknown>;
        for (const key of ["error", "message", "reason", "code"]) collect(fields[key], depth + 1);
      }
    };
    collect(value, 0);
    reason = parts.join("; ") || "No readable rejection reason";
  } catch {
    /* Some bridges return a plain-text reason. */
  }
  for (const value of sensitive.filter(Boolean).sort((a, b) => b.length - a.length)) {
    reason = reason.split(value).join("[redacted]");
  }
  return (
    reason
      .replace(/https?:\/\/[^\s<>"']+/gi, "[redacted URL]")
      .replace(/[^\s<>"']+@[^\s<>"']+/g, "[redacted email]")
      .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
      .replace(
        /\b(?:secret|token|signature|authorization|api[_-]?key)\b\s*[:=]\s*\S+/gi,
        "credential=[redacted]",
      )
      .replace(/[A-Za-z0-9_+/.=-]{32,}/g, "[redacted token]")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220) || "Empty rejection response"
  );
}

/** Adapter over a validated config. fetchImpl injectable for tests. Never logs or returns the secret. */
export function bridgeAdapter(
  cfg: Base44BridgeConfig,
  fetchImpl: typeof fetch = fetch,
): DeliveryAdapter {
  return {
    provider: "base44_bridge",
    async deliver(msg: DeliveryMessage) {
      const body = bridgeBody(msg);
      const signature = await hmacHex(cfg.secret, body);
      const res = await fetchImpl(cfg.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hivic-signature": signature,
          "Idempotency-Key": msg.idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const raw = await res.text().catch(() => "Rejection response unavailable");
        const reason = bridgeRejectionReason(raw, [
          cfg.secret,
          signature,
          cfg.url,
          msg.to,
          msg.html,
          msg.text,
          msg.subject,
          msg.idempotencyKey,
        ]);
        throw new DeliveryRejectedError(`Base44 delivery bridge returned ${res.status}: ${reason}`);
      }
      const j = (await res.json().catch(() => ({}))) as { message_id?: string };
      return { providerMessageId: j.message_id ?? null };
    },
  };
}
