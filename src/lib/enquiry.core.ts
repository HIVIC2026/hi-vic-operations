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
  likely_eligible: "Review Gate 1 and arrange electrician assessment",
  needs_onsite_confirmation: "Review Gate 1 and confirm onsite checks",
  does_not_appear_eligible: "Review Gate 1 before closing enquiry",
};

/** Job fields for a preliminary (website) eligibility result. Information only — never sets the pipeline stage, never auto-passes. */
export function preliminaryEligibilityFields(outcome: PreliminaryEligibility | null | undefined, reason: string | null | undefined, now: Date = new Date()) {
  if (!outcome) return null;
  return {
    eligibility_outcome: outcome,
    eligibility_reason: reason ?? null,
    eligibility_set_at: now.toISOString(),
    eligibility_set_by: null,
    next_action: PRELIM_NEXT_ACTION[outcome],
  };
}

/** Operational stage + next action for every NEW Base44 job. Admin confirms Gate 1 and moves it forward. */
export const BASE44_NEW_STAGE = "new_enquiry" as const;
export const BASE44_NEW_NEXT_ACTION = "Review website screening and Gate 1";

export type LifeSupportStatus = "yes" | "no" | "unknown";

/** Sanitize reasons: strip control chars, collapse whitespace, drop empties/dupes, cap 20 x 300 chars, joined ≤2000. */
export function joinReasons(reasons: readonly string[] | null | undefined): string | null {
  if (!reasons?.length) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const r of reasons.slice(0, 20)) {
    const c = String(r).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
    if (c && !seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  }
  return out.length ? out.join("; ").slice(0, 2000) : null;
}

export type Base44Fields = {
  external_enquiry_id?: string | null | undefined; source_reference?: string | null | undefined;
  life_support?: boolean | null | undefined; life_support_status?: LifeSupportStatus | null | undefined;
  preliminary_outcome?: PreliminaryEligibility | null | undefined; preliminary_reasons?: string[] | null | undefined;
  eligibility_outcome?: PreliminaryEligibility | null | undefined; eligibility_reason?: string | null | undefined;
};

/** life_support is true ONLY for an explicit "yes"; "unknown" is kept as a status (never a silent confirmed no). */
export function resolveLifeSupport(i: Pick<Base44Fields, "life_support" | "life_support_status">): { life_support: boolean; status: LifeSupportStatus } {
  if (i.life_support_status) return { life_support: i.life_support_status === "yes", status: i.life_support_status };
  if (i.life_support === true) return { life_support: true, status: "yes" };
  if (i.life_support === false) return { life_support: false, status: "no" };
  return { life_support: false, status: "unknown" };
}

/**
 * Pure plan for a Base44 enquiry against the (possibly) existing job for the same external_enquiry_id.
 * existing = null -> create in new_enquiry; otherwise update the SAME job. Never changes an existing job's stage.
 */
export function planBase44Job(input: Base44Fields, existing: { stage: string } | null, now: Date = new Date()) {
  const outcome = input.preliminary_outcome ?? input.eligibility_outcome ?? null;
  const reason = joinReasons(input.preliminary_reasons) ?? input.eligibility_reason ?? null;
  const ls = resolveLifeSupport(input);
  const prelim = preliminaryEligibilityFields(outcome, reason, now);
  const patch: Record<string, unknown> = { life_support: ls.life_support, ...(prelim ?? {}) };
  if (existing) delete patch["next_action"]; // repeat sync: information only, leave workflow untouched
  else patch["next_action"] = BASE44_NEW_NEXT_ACTION;
  const moveTo = null;
  void existing?.stage;
  const details = {
    external_enquiry_id: input.external_enquiry_id ?? null, source_reference: input.source_reference ?? null,
    preliminary: true, preliminary_outcome: outcome, preliminary_reasons: reason,
    life_support_status: ls.status, life_support_unconfirmed: ls.status === "unknown",
  };
  return { kind: existing ? ("update" as const) : ("create" as const), patch, moveTo, details, outcome };
}

export type Base44EvidenceInput = {
  declared_property_type?: string | null | undefined;
  declared_over_five_years?: "yes" | "no" | "unknown" | null | undefined;
  declared_previous_upgrade?: "yes" | "no" | "unknown" | null | undefined;
  property_research?: {
    status?: string | null | undefined; evidence_summary?: string | null | undefined; formatted_address?: string | null | undefined;
    state?: string | null | undefined; postcode?: string | null | undefined; premises_classification?: string | null | undefined;
    first_appearance_year?: number | null | undefined; age_evidence_source?: string | null | undefined;
    flat_roof_detected?: boolean | null | undefined; access_concern_detected?: boolean | null | undefined; verified_floor_plan_url?: string | null | undefined;
  } | null | undefined;
};

/**
 * Pure: Base44 Gate 1 evidence with provenance. Owner declarations live under `declared` and are never
 * promoted to verified. Research age is `age_verified` only when research is complete AND a first-appearance year exists.
 */
export function buildBase44Evidence(i: Base44EvidenceInput, now: Date = new Date()) {
  const r = i.property_research ?? null;
  const done = !!r?.status && ["complete", "completed", "verified", "success", "done"].includes(r.status.toLowerCase());
  return {
    source: "base44", received_at: now.toISOString(),
    declared: {
      basis: "owner_declaration",
      property_type: i.declared_property_type ?? null,
      over_five_years: i.declared_over_five_years ?? null,
      previous_upgrade: i.declared_previous_upgrade ?? null,
    },
    research: r ? {
      basis: "base44_property_research",
      status: r.status ?? null, evidence_summary: r.evidence_summary ?? null,
      formatted_address: r.formatted_address ?? null, state: r.state?.toUpperCase() ?? null, postcode: r.postcode ?? null,
      premises_classification: r.premises_classification ?? null,
      first_appearance_year: r.first_appearance_year ?? null, age_evidence_source: r.age_evidence_source ?? null,
      age_verified: done && r.first_appearance_year != null,
      flat_roof_detected: r.flat_roof_detected === true, access_concern_detected: r.access_concern_detected === true,
      verified_floor_plan_url: r.verified_floor_plan_url ?? null,
    } : null,
  };
}
