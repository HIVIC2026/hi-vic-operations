// Slice 1 pure rules: Ready Check visit coordination.
// No I/O. Decides display state, next action, who may confirm, timer schedule
// and retry targets. Persistence and locking live in the rc_* database functions.

export type VisitStatus =
  | "awaiting_assignment"
  | "awaiting_contact"
  | "awaiting_time"
  | "awaiting_confirmation"
  | "booked"
  | "cancelled"
  | "office_review"; // manual coordination (flag off or legacy job)

export type Party = { kind: "owner"; ownerId: string } | { kind: "trade"; userId: string } | { kind: "office"; userId: string };

export type VisitFacts = {
  coordinationEnabled: boolean;
  estimateApproved: boolean;
  ownerRequested: boolean;
  assignment: { id: string; version: number; tradeUserId: string } | null;
  contactsReleased: boolean;
  openProposal: { id: string; version: number; enteredBy: Party; assignmentVersion: number } | null;
  confirmedBooking: boolean;
  cancelled: boolean;
};

/** Visit status. Confirmed bookings are always kept, even with the flag off. */
export function visitStatus(f: VisitFacts): VisitStatus {
  if (f.cancelled) return "cancelled";
  if (f.confirmedBooking) return "booked";
  if (!f.coordinationEnabled || !f.estimateApproved || !f.ownerRequested) return "office_review";
  if (!f.assignment) return "awaiting_assignment";
  if (!f.contactsReleased) return "awaiting_contact";
  if (!f.openProposal || f.openProposal.assignmentVersion !== f.assignment.version) return "awaiting_time";
  return "awaiting_confirmation";
}

export type Role = "office" | "owner" | "trade";

/** One primary next action per role. null = nothing for that person. */
export function nextAction(f: VisitFacts, role: Role): string | null {
  const s = visitStatus(f);
  if (s === "booked" || s === "cancelled") return null;
  if (s === "office_review") {
    if (role !== "office") return null;
    if (!f.estimateApproved) return "Approve estimate";
    return "Office review: set up visit";
  }
  if (s === "awaiting_assignment") return role === "office" ? "Assign installer" : null;
  if (s === "awaiting_contact") return role === "office" ? "Share contacts for this visit" : null;
  if (s === "awaiting_time") return role === "trade" ? "Contact owner and enter time" : role === "owner" ? "Enter the agreed time" : null;
  // awaiting_confirmation: only the exact counterpart (or office) confirms
  const by = f.openProposal!.enteredBy;
  if (role === "office") return "Confirm time";
  if (role === "owner" && by.kind === "trade") return "Confirm time";
  if (role === "trade" && by.kind === "owner") return "Confirm time";
  return null;
}

function sameParty(a: Party, b: Party): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "owner") return a.ownerId === (b as { ownerId: string }).ownerId;
  return a.userId === (b as { userId: string }).userId;
}

export type ConfirmInput = {
  facts: VisitFacts;
  confirmer: Party;
  jobOwnerId: string;
  proposalId: string;
  proposalVersion: number;
  officeEvidence?: { method: string; note: string } | null;
};

/** Who may confirm: the exact counterpart on the current assignment and proposal version, or office with evidence. */
export function confirmBlocker(i: ConfirmInput): string | null {
  const f = i.facts;
  if (visitStatus(f) !== "awaiting_confirmation") return "There is no time waiting for confirmation.";
  const p = f.openProposal!;
  const a = f.assignment!;
  if (p.id !== i.proposalId || p.version !== i.proposalVersion) return "This time has changed. Reload and check the latest time.";
  if (p.assignmentVersion !== a.version) return "The installer has changed. A new time is needed.";
  if (sameParty(p.enteredBy, i.confirmer)) return "The other party must confirm this time.";
  if (i.confirmer.kind === "office") {
    if (!i.officeEvidence?.method?.trim() || !i.officeEvidence?.note?.trim()) return "Record how the time was agreed.";
    return null;
  }
  if (i.confirmer.kind === "owner") {
    if (i.confirmer.ownerId !== i.jobOwnerId) return "Only the owner on this job can confirm.";
    return p.enteredBy.kind === "trade" && p.enteredBy.userId === a.tradeUserId ? null : "Only the owner can confirm the installer's time.";
  }
  // trade
  if (i.confirmer.userId !== a.tradeUserId) return "Only the assigned installer can confirm.";
  return p.enteredBy.kind === "owner" ? null : "Only the installer can confirm the owner's time.";
}

export const HOUR = 3_600_000;

export type TaskKind = "reminder_24h" | "office_alert_48h";

/** Tasks for an episode (episode starts when contacts are shared; reschedule/reassign starts a new one). */
export function scheduleTasks(episodeStartMs: number): { kind: TaskKind; dueAtMs: number }[] {
  return [
    { kind: "reminder_24h", dueAtMs: episodeStartMs + 24 * HOUR },
    { kind: "office_alert_48h", dueAtMs: episodeStartMs + 48 * HOUR },
  ];
}

/** Whether a due task still applies when it runs. The 48h alert stands even if a time was entered. */
export function taskStillApplies(kind: TaskKind, status: VisitStatus): boolean {
  if (status === "booked" || status === "cancelled" || status === "office_review") return false;
  if (kind === "reminder_24h") return status === "awaiting_time";
  return true;
}

export type RecipientOutcome = "pending" | "sent" | "suppressed" | "failed" | "unknown";

/** Retry only failed recipients. Suppressed and unknown are never resent automatically. */
export function retryTargets(rows: { recipient: string; outcome: RecipientOutcome }[]): string[] {
  return rows.filter((r) => r.outcome === "failed").map((r) => r.recipient);
}

export type DeliveryGate = { switchOn: boolean; consentCurrent: boolean; assignmentCurrent: boolean; deliveryUnknown: boolean };

/** Every send and retry passes the same gate; with sends off the result is suppressed and closed. */
export function deliveryDecision(g: DeliveryGate): "send" | "suppress" | "block" {
  if (g.deliveryUnknown) return "block";
  if (!g.consentCurrent || !g.assignmentCurrent) return "block";
  if (!g.switchOn) return "suppress";
  return "send";
}

/** A lease is reclaimable once it has expired. */
export function leaseReclaimable(leaseUntilMs: number | null, nowMs: number): boolean {
  return leaseUntilMs === null || leaseUntilMs <= nowMs;
}

/** Stage-exit rule: no job leaves Ready Check booking unless the visit is confirmed for the current assignment. */
export function bookingStageExitBlocker(from: string, to: string, f: VisitFacts): string | null {
  const guarded = from === "assessment_booking" && to === "assessment_booked";
  if (!guarded) return null;
  if (!f.estimateApproved) return "Estimate not approved by office.";
  if (!f.ownerRequested) return "Owner has not requested the Ready Check.";
  if (!f.confirmedBooking) return "The visit time has not been confirmed by the other party.";
  return null;
}

/** Needs attention items for message recipients. Failed, undelivered and suppressed-with-follow-up rows always surface,
 *  with who / what / why. Delivered, read or link-opened never count as approval and never progress workflow. */
export type MessageRow = { id: string; jobId: string; recipient: string; channel: "email" | "sms"; template: string;
  outcome: "prepared" | "queued" | "sent" | "delivered" | "failed" | "undelivered" | "suppressed"; reason?: string | null; followUp?: boolean };
export type AttentionItem = { code: "failed_message"; jobId: string; messageId: string; who: string; what: string; why: string };
export function failedMessageAttention(rows: MessageRow[]): AttentionItem[] {
  return rows
    .filter((r) => r.outcome === "failed" || r.outcome === "undelivered" || (r.outcome === "suppressed" && r.followUp))
    .map((r) => ({ code: "failed_message", jobId: r.jobId, messageId: r.id, who: r.recipient, what: `${r.channel} · ${r.template}`,
      why: r.reason?.trim() || (r.outcome === "suppressed" ? "Held: sending is switched off" : "No reason given by the provider") }));
}
