// Resend delivery updates: pure rules. Signature check follows Svix (what Resend uses), event mapping, plain bounce words.
import { createHmac } from "node:crypto";

export type DeliveryResult = "delivered" | "bounced";

const MAX_AGE_S = 300;

const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

/** Svix scheme: HMAC-SHA256 of `${id}.${timestamp}.${raw}` keyed by the base64 secret after `whsec_`. Any `v1,` entry may match. */
export function verifyResendSignature(raw: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, nowMs: number): boolean {
  if (!secret || !headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > MAX_AGE_S) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${raw}`).digest("base64");
  return headers.signature.split(/\s+/).some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && same(sig, expected);
  });
}

/** Plain-words reason for a bounce. */
export function bounceWords(raw: string | null): string {
  const t = (raw ?? "").toLowerCase();
  if (/user unknown|unknown user|mailbox (not found|unavailable|does not exist)|does not exist|no such (user|mailbox)|address rejected|invalid (recipient|mailbox)/.test(t)) return "Email address doesn't exist";
  if (/mailbox full|over quota|quota exceeded|inbox is full/.test(t)) return "Their inbox is full";
  return "Their email provider refused it";
}

/** `email.delivered` and `email.bounced` become a result; every other event (or one without an email id) is ignored. */
export function resendEventResult(evt: { type: string; data?: { email_id?: string; bounce?: { message?: string; subType?: string } } }): { emailId: string; result: DeliveryResult; detail: string | null } | null {
  const emailId = evt?.data?.email_id;
  if (!emailId) return null;
  if (evt.type === "email.delivered") return { emailId, result: "delivered", detail: null };
  if (evt.type === "email.bounced") return { emailId, result: "bounced", detail: bounceWords(evt.data?.bounce?.message ?? null) };
  return null;
}
