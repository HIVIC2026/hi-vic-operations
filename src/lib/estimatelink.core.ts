// Step 3 secure no-login estimate link: pure rules (token, lifecycle, delivery readiness). No I/O.
import type { DisplayMode } from "./estimate.core";

export const LINK_PURPOSE = "step3_estimate" as const;
export const LINK_TTL_DAYS = 30;
export const TOKEN_BYTES = 32; // 256 bits
export const LINK_ADMIN_WARNING = "Anyone with this secure link can view this estimate. Do not post it publicly.";
export const LINK_COMMS_OFF = "Customer communications OFF — link has not been sent";
export const LINK_UNAVAILABLE = "This estimate link is not available. Please contact Home Insulation Victoria.";

const TOKEN_RE = /^[A-Za-z0-9_-]{43,128}$/;

/** Cryptographically random, URL-safe (base64url, no padding), 256 bits. */
export function newToken(): string {
  const b = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(b);
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function isWellFormedToken(t: unknown): t is string {
  return typeof t === "string" && TOKEN_RE.test(t);
}

/** Gate 1 permits a customer link only for likely / onsite (rollout hold does not matter). */
export function linkAllowed(mode: DisplayMode | string): boolean {
  return mode === "likely" || mode === "onsite";
}

export type LinkRow = { id: string; status: string; expires_at: string };
export type LinkPlan = { action: "reuse" | "issue" | "revoke" | "none"; expire?: string[] };

/** Idempotent: reuse the one active unexpired link; expire stale ones; issue only when allowed and none usable; revoke when not allowed. */
export function planLink(active: LinkRow | null, allowed: boolean, now = Date.now()): LinkPlan {
  const expired = active && Date.parse(active.expires_at) <= now;
  if (!allowed) return active ? { action: "revoke" } : { action: "none" };
  if (active && !expired) return { action: "reuse" };
  return { action: "issue", expire: expired && active ? [active.id] : [] };
}

export function expiryFrom(now = Date.now()): string {
  return new Date(now + LINK_TTL_DAYS * 86_400_000).toISOString();
}

/** Link usable by the public resolver right now. */
export function linkUsable(l: { status: string; expires_at: string } | null, now = Date.now()): boolean {
  return !!l && l.status === "active" && Date.parse(l.expires_at) > now;
}

export type DeliveryState = "no_link" | "prepared_delivery_locked" | "prepared_no_consent" | "ready";
export function deliveryState(x: { activeLink: boolean; consent: boolean; commsEnabled: boolean }): DeliveryState {
  if (!x.activeLink) return "no_link";
  if (!x.commsEnabled) return "prepared_delivery_locked";
  if (!x.consent) return "prepared_no_consent";
  return "ready";
}

/** Public payload whitelist — anything else is dropped. */
export function publicPayload(job: { job_number: string | null; address: string | null }, view: Record<string, unknown>, referralShareUrl: string | null = null) {
  return { job: { job_number: job.job_number, address: job.address }, estimate: view, referralShareUrl };
}
