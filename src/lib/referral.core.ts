// Customer referral links: pure rules. Share URL carries only an opaque 256-bit token — never job/email/name/phone.
import { newToken, isWellFormedToken } from "./estimatelink.core";

export const REFERRAL_BASE = "https://homeinsulationvictoria.com.au/homeowner";
export const newReferralToken = newToken; // 43-char base64url
export const isReferralToken = (t: unknown): t is string => isWellFormedToken(t) && t.length === 43;
export const referralShareUrl = (token: string) => `${REFERRAL_BASE}?ref=${token}`;

const EXT_RE = /^[A-Za-z0-9_-]{1,128}$/;
export const isExternalEnquiryId = (x: unknown): x is string => typeof x === "string" && EXT_RE.test(x);

/** Reuse the one active token for this owner (job or external enquiry); otherwise issue. */
export function planReferralToken(active: { id: string; status: string } | null): "reuse" | "issue" {
  return active && active.status === "active" ? "reuse" : "issue";
}

const bucket10m = (at: number) => Math.floor(at / 600_000);
export const referralDedupe = {
  created: (tokenId: string) => `created:${tokenId}`,
  click: (tokenId: string, at = Date.now()) => `click:${tokenId}:${bucket10m(at)}`,
  submission: (tokenId: string, externalEnquiryId: string) => `submission:${tokenId}:${externalEnquiryId}`,
};

export const clickBody = (b: unknown) => (b && typeof b === "object" && isReferralToken((b as { token?: unknown }).token) ? { token: (b as { token: string }).token } : null);
/** Submission body: token + external enquiry id ONLY. Anything else (friend PII) is dropped. */
export function submissionBody(b: unknown): { token: string; external_enquiry_id: string } | null {
  if (!b || typeof b !== "object") return null;
  const { token, external_enquiry_id } = b as Record<string, unknown>;
  return isReferralToken(token) && isExternalEnquiryId(external_enquiry_id) ? { token, external_enquiry_id } : null;
}
