// P1-S23B — FFS minimum field progress / result recording (Option B, owner-approved).
//
// FFS = an approved partner business member (business_admin) who holds no installer/electrician
// trade role. This module is deliberately INFORMATIONAL: it formats one workflow event and never
// changes the job's primary status, never satisfies an installer/electrician completion, and never
// sends anything to the customer. Authorisation lives in ./ffs-progress.server.ts — this file is
// pure so it can be tested without a database.

/** The single informational event type FFS recording writes. No stage transition, no automation. */
export const FFS_PROGRESS_EVENT = "ffs_progress_result";

/** Narrow, non-regulated result categories. They are NOT job stages and are NOT completion states. */
export const FFS_RESULTS = [
  { value: "site_visited", label: "Site visited" },
  { value: "progress_made", label: "Progress made" },
  { value: "issue_found", label: "Issue found" },
  { value: "awaiting_access", label: "Couldn't get access" },
] as const;

export type FfsResult = (typeof FFS_RESULTS)[number]["value"];

export const FFS_RESULT_VALUES: readonly FfsResult[] = FFS_RESULTS.map((r) => r.value);

/** Longest note accepted. Keeps the record short and the audit line readable. */
export const FFS_NOTE_MAX = 500;

export function isFfsResult(v: unknown): v is FfsResult {
  return typeof v === "string" && (FFS_RESULT_VALUES as readonly string[]).includes(v);
}

export function ffsResultLabel(v: FfsResult): string {
  return FFS_RESULTS.find((r) => r.value === v)?.label ?? v;
}

/** Human-readable one-liner shown to the office in the job timeline. */
export function ffsSummary(result: FfsResult, note: string): string {
  const head = note.length > 90 ? `${note.slice(0, 89).trimEnd()}…` : note;
  return `FFS update · ${ffsResultLabel(result)}${head ? ` — ${head}` : ""}`;
}

/** Timeline search should find FFS records by label and note text. */
export function ffsSearchText(summary: string): string {
  return summary;
}

/**
 * Validate a submission. Throws a plain Error (isomorphic; the server wraps it as WorkflowError
 * so the field UI shows a clean message). Never trusts a client-supplied id, role or business.
 */
export function parseFfsProgress(input: { result?: unknown; note?: unknown }): {
  result: FfsResult;
  note: string;
} {
  if (!isFfsResult(input.result)) {
    throw new Error(`Unsupported FFS result. Choose one of: ${FFS_RESULT_VALUES.join(", ")}.`);
  }
  const raw = typeof input.note === "string" ? input.note : "";
  const note = raw.trim().replace(/\s+\n/g, "\n");
  if (!note) throw new Error("Add a short note so the office knows what you found.");
  if (note.length > FFS_NOTE_MAX) throw new Error(`Keep the note to ${FFS_NOTE_MAX} characters.`);
  return { result: input.result, note };
}

/** Reads back a stored FFS event into the shape the field UI renders. */
export type FfsRecord = {
  id: string;
  at: string;
  actorId: string | null;
  result: FfsResult;
  label: string;
  note: string;
  businessId: string | null;
  businessName: string | null;
};

export function toFfsRecord(row: {
  id: string;
  created_at: string;
  actor_id: string | null;
  event_type: string;
  details: unknown;
}): FfsRecord | null {
  if (row.event_type !== FFS_PROGRESS_EVENT) return null;
  const d = (row.details ?? {}) as {
    result?: unknown;
    note?: unknown;
    business_id?: unknown;
    business_name?: unknown;
  };
  const result = isFfsResult(d.result) ? d.result : "progress_made";
  return {
    id: row.id,
    at: row.created_at,
    actorId: row.actor_id ?? null,
    result,
    label: ffsResultLabel(result),
    note: typeof d.note === "string" ? d.note : "",
    businessId: typeof d.business_id === "string" ? d.business_id : null,
    businessName: typeof d.business_name === "string" ? d.business_name : null,
  };
}
