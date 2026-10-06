import { melbourneToday } from "./melbourne-time.core";
// Pure VEEC lodgement rules. No I/O. Used by updateVeec and stageEntryBlockers("complete").
export type VeecStatus = "not_submitted" | "submitted" | "query" | "approved" | "rejected";
export interface VeecRecord {
  status: VeecStatus | string;
  quantity: number | null;
  submission_reference: string | null;
  submitted_date: string | null; // YYYY-MM-DD
  notes: string | null;
  query_text?: string | null;
  query_received_at?: string | null; // YYYY-MM-DD
  reply_draft?: string | null;
  reply_sent_at?: string | null; // YYYY-MM-DD
}

const ALLOWED: Record<string, VeecStatus[]> = {
  not_submitted: ["not_submitted", "submitted"],
  submitted: ["submitted", "query", "approved", "rejected"],
  query: ["query", "submitted", "approved", "rejected"],
  rejected: ["rejected", "submitted"],
  approved: ["approved"], // final — registered certificates cannot be reverted here
};

/** A job becomes Complete only once its VEEC is registered (approved); submitted, query and rejected keep it open. */
export function veecCompletesJob(status: VeecStatus | string): boolean {
  return status === "approved";
}

/** Whole days until an unanswered Registry query escalates to the AP. */
export const VEEC_QUERY_ESCALATE_DAYS = 3;

/** True when a Registry query has had no reply recorded for the escalation window. */
export function veecQueryOverdue(queryReceivedAt: string | null | undefined, replySentAt: string | null | undefined, now: Date): boolean {
  if (!queryReceivedAt || replySentAt) return false;
  // Review G: whole Melbourne calendar days (not UTC midnight, not fixed hours).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(queryReceivedAt)) return false;
  const [y, m, d] = melbourneToday(now).split("-").map(Number);
  const [ry, rm, rd] = queryReceivedAt.split("-").map(Number);
  const days = Math.round((Date.UTC(y!, m! - 1, d!) - Date.UTC(ry!, rm! - 1, rd!)) / 86_400_000);
  return days >= VEEC_QUERY_ESCALATE_DAYS;
}

/** Today's date (YYYY-MM-DD) in Melbourne. */
export function melbourneToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

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
  if (next.status === "query") {
    if (!(next.query_text && next.query_text.trim().length >= 5)) out.push("What the Registry asked is required.");
    if (!(next.query_received_at && /^\d{4}-\d{2}-\d{2}$/.test(next.query_received_at))) out.push("The date the query arrived is required.");
    else if (next.query_received_at > today) out.push("Query received date cannot be in the future.");
  }
  const lodged = from === "submitted" || from === "approved";
  const changed = prev && (prev.quantity !== next.quantity || prev.submission_reference !== next.submission_reference || prev.submitted_date !== next.submitted_date);
  if (lodged && changed && !(next.reason && next.reason.trim().length >= 5)) out.push("A reason is required to change lodged VEEC details.");
  return out;
}
