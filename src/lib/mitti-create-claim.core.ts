// T3: atomic, per-job / per-form-type claim for creating a Mitti form (pure rules; no I/O).
//
// The claim is a workflow_events row whose PRIMARY KEY is derived from (job, form kind, generation).
// Two creators racing for the same generation compute the same id, so the database lets exactly one
// insert succeed (unique violation for the other). No new table or migration is needed.
//
// A generation only advances when an attempt is RELEASED, which happens only when it is certain that
// Mitti did not create anything (the failure happened before the create call). If the create call may
// have reached Mitti (timeout, 5xx, lost response) the claim is kept and recorded as uncertain, so no
// automatic path can create a second form. Only an explicit office action may override an old uncertain
// claim (see mitti-create.server.ts).

export type MittiFormKind = "ready_check" | "piesa";

export const CLAIM_EVENT = "mitti_audit_create_started";
export const RELEASE_EVENT = "mitti_audit_create_released";
export const UNCERTAIN_EVENT = "mitti_audit_create_uncertain";
export const OFFICE_OVERRIDE_EVENT = "mitti_audit_create_office_override";

/** Thrown text when a claim is held (in progress, or outcome unknown). Kept identical to the original guard text. */
export const CLAIM_HELD =
  "Mitti form creation was already started recently. Do not retry yet; check Mitti or wait for the office to reconcile the result.";
export const OUTCOME_UNCERTAIN =
  "Mitti may have created the form but the reply was lost. Not retried automatically — the office will check Mitti and reconcile it.";

/** An office override is only possible once a held claim is at least this old. */
export const OFFICE_OVERRIDE_AFTER_MS = 10 * 60_000;

/** Deterministic RFC-4122-shaped id (version 5 style, SHA-256 based) from a string. */
export async function stableUuid(seed: string): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed))).slice(0, 16);
  d[6] = (d[6]! & 0x0f) | 0x50;
  d[8] = (d[8]! & 0x3f) | 0x80;
  const h = [...d].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const claimEventId = (jobId: string, kind: MittiFormKind, generation: number) => stableUuid(`mitti-create:${jobId}:${kind}:${generation}`);
export const releaseEventId = (claimId: string) => stableUuid(`mitti-create-release:${claimId}`);

/**
 * What happened to a create attempt, from what the code observed:
 *  - "created": Mitti returned an audit id (stored so the next attempt reuses it).
 *  - "not_created": the attempt failed before the create call was sent — safe to release the claim.
 *  - "uncertain": the create call was sent but no audit id came back — keep the claim, never auto-retry.
 */
export function createOutcome(o: { createAttempted: boolean; createdId: string | null }): "created" | "not_created" | "uncertain" {
  if (o.createdId) return "created";
  return o.createAttempted ? "uncertain" : "not_created";
}

export const isUniqueViolation = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "23505" || /duplicate key|already exists/i.test(e.message ?? ""));
