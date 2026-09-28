// Pure, runtime-agnostic helpers for the Base44 -> portal enquiry handoff (no DB, no env). Tested in tests/enquiry.core.test.ts.

/** Trusted Base44 Ed25519 public key (SPKI DER, base64). Public by design — no secret required. */
export const BASE44_PUBLIC_KEY_SPKI_B64 = "MCowBQYDK2VwAyEA4ZW3Pv8Mb6v9e684gaMN3HHB8qGLvW6LCMOPU7ki6U0=";
export const BASE44_KEY_ID = "base44-v1";

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const s = b64.trim();
    if (!s || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return null;
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    const out = new Uint8Array(new ArrayBuffer(bin.length));
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Verify an Ed25519 signature (base64) over the exact raw UTF-8 body. Never throws; false on any problem. */
export async function verifyEd25519(rawBody: string, signatureB64: string | null | undefined, publicKeySpkiB64 = BASE44_PUBLIC_KEY_SPKI_B64): Promise<boolean> {
  if (!signatureB64) return false;
  const sig = b64ToBytes(signatureB64);
  const der = b64ToBytes(publicKeySpkiB64);
  if (!sig || sig.length !== 64 || !der) return false;
  try {
    const key = await crypto.subtle.importKey("spki", der, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, new TextEncoder().encode(rawBody));
  } catch {
    return false;
  }
}

export type PreliminaryEligibility = "likely_eligible" | "needs_onsite_confirmation" | "does_not_appear_eligible";

export const PRELIM_NEXT_ACTION: Record<PreliminaryEligibility, string> = {
  likely_eligible: "Confirm eligibility and arrange electrician assessment",
  needs_onsite_confirmation: "Review onsite confirmation requirements",
  does_not_appear_eligible: "Review eligibility outcome before closing",
};

/** Job fields for a preliminary (website) eligibility result. Lands in eligibility_review for admin confirmation — never auto-passes. */
export function preliminaryEligibilityFields(outcome: PreliminaryEligibility | null | undefined, reason: string | null | undefined, now: Date = new Date()) {
  if (!outcome) return null;
  return {
    eligibility_outcome: outcome,
    eligibility_reason: reason ?? null,
    eligibility_set_at: now.toISOString(),
    eligibility_set_by: null,
    next_action: PRELIM_NEXT_ACTION[outcome],
    stage: "eligibility_review" as const,
  };
}

/** Stages from which an idempotent website update may (re)place the job into eligibility_review. Later stages are never moved backwards. */
export const PRELIM_STAGE_ALLOWED_FROM = ["new_enquiry", "eligibility_review"] as const;
