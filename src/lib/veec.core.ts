// Pure VEEC lodgement rules. No I/O. Used by updateVeec and stageEntryBlockers("complete").
export type VeecStatus = "not_submitted" | "submitted" | "approved" | "rejected";
export interface VeecRecord {
  status: VeecStatus | string;
  quantity: number | null;
  submission_reference: string | null;
  submitted_date: string | null; // YYYY-MM-DD
  notes: string | null;
}

const ALLOWED: Record<string, VeecStatus[]> = {
  not_submitted: ["not_submitted", "submitted"],
  submitted: ["submitted", "approved", "rejected"],
  rejected: ["rejected", "submitted"],
  approved: ["approved"], // final — registered certificates cannot be reverted here
};

/** Why a lodged record is not a real lodgement (empty = sufficient). */
export function lodgementEvidenceBlockers(v: VeecRecord | null, today: string): string[] {
  const out: string[] = [];
  if (!v || !["submitted", "approved"].includes(v.status)) return ["VEEC lodgement not submitted."];
  if (v.quantity == null || !Number.isFinite(v.quantity) || v.quantity <= 0) out.push("VEEC quantity must be greater than 0.");
  if (!v.submission_reference || v.submission_reference.trim().length < 3) out.push("ESC submission reference is required.");
  if (!v.submitted_date || !/^\d{4}-\d{2}-\d{2}$/.test(v.submitted_date)) out.push("Submitted date is required.");
  else if (v.submitted_date > today) out.push("Submitted date cannot be in the future.");
  return out;
}

/** Validate a proposed update against the current record. */
export function veecUpdateBlockers(prev: VeecRecord | null, next: VeecRecord & { reason?: string | null }, today: string): string[] {
  const from = prev?.status ?? "not_submitted";
  const out: string[] = [];
  if (!(ALLOWED[from] ?? []).includes(next.status as VeecStatus)) out.push(`Cannot change VEEC status from ${from.replace("_", " ")} to ${String(next.status).replace("_", " ")}.`);
  if (next.status === "submitted" || next.status === "approved") out.push(...lodgementEvidenceBlockers(next, today));
  if (next.status === "rejected" && !(next.notes && next.notes.trim().length >= 5)) out.push("Rejection notes are required.");
  const lodged = from === "submitted" || from === "approved";
  const changed = prev && (prev.quantity !== next.quantity || prev.submission_reference !== next.submission_reference || prev.submitted_date !== next.submitted_date);
  if (lodged && changed && !(next.reason && next.reason.trim().length >= 5)) out.push("A reason is required to change lodged VEEC details.");
  return out;
}
