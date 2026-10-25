// Visit allocation (decision 161, Jo 24 Oct 2026). PURE: no I/O.
// The business owner allocates each visit to one of their own staff (My business → Team):
//   - Ready Check: ANY staff member still on the list (any trade role);
//   - Install day (PIISA / install): ONLY CII-cleared installers (crewClearance, decision 153).
// Saving is an append-only `visit_allocated` workflow event (latest per visit kind wins); the server re-assigns the
// Mitti form to that person's own Mitti user (looked up by the email on their staff row) and the 6:30am text goes to
// their mobile instead of the owner's. Nothing here changes stages, bookings, quotes or pay.
import { crewClearance, whiteCardBlocker, type CrewClearanceFacts, type WhiteCardState } from "./worker-compliance.core";

export type VisitKind = "ready_check" | "install";
export const VISIT_ALLOCATED_EVENT = "visit_allocated";
export const VISIT_LABEL: Record<VisitKind, string> = { ready_check: "Ready Check", install: "Install day" };

/** One staff row as the picker sees it (from partner_workers + the derived clearance facts for installers). */
export type AllocationCandidate = {
  workerId: string;
  name: string;
  tradeRole: string;
  email: string | null;
  mobile: string | null;
  removedAt?: string | null;
  /** Clearance facts for installers (decision 153). Omitted/undefined = not loaded → never cleared for install days. */
  clearance?: CrewClearanceFacts | null;
  /** Decision 319: White Card state (installers). Undefined = not loaded → the White Card rule is not applied. */
  whiteCard?: WhiteCardState | null;
};

export type AllocationOption = { workerId: string; name: string; mobile: string | null; allowed: boolean; reason: string | null; note: string | null };

export const ALLOCATION_REASON = {
  removed: "No longer on the staff list.",
  notInstaller: "Only installers can be given an install day.",
  noMobile: "No mobile on file – the 6:30am text will go to you.",
} as const;

/** Why this person can't take this visit (null = allowed). Fails closed for install days.
 *  `install.bookingCreatedAt` (decision 319): when given, an install day also needs a verified White Card unless the
 *  installation was booked before `WHITE_CARD_ENFORCED_FROM` (null = not booked yet = enforced). */
export function allocationBlocker(kind: VisitKind, c: AllocationCandidate, today: string, install?: { bookingCreatedAt: string | null }): string | null {
  if (c.removedAt) return ALLOCATION_REASON.removed;
  if (kind === "ready_check") return null;
  if (c.tradeRole !== "installer") return ALLOCATION_REASON.notInstaller;
  const cl = crewClearance(c.clearance ?? { certStatus: null, level: null, expiresOn: null }, today);
  if (!cl.cleared) return cl.reason;
  return install ? whiteCardBlocker(c.whiteCard, install.bookingCreatedAt) : null;
}

/** The picker list: everyone still on the list, greyed out with the reason when not allowed for this visit. */
export function allocationOptions(kind: VisitKind, candidates: AllocationCandidate[], today: string, install?: { bookingCreatedAt: string | null }): AllocationOption[] {
  return candidates.filter((c) => !c.removedAt).map((c) => {
    const reason = allocationBlocker(kind, c, today, install);
    return { workerId: c.workerId, name: c.name, mobile: c.mobile, allowed: reason === null, reason, note: reason === null && !c.mobile ? ALLOCATION_REASON.noMobile : null };
  }).sort((a, b) => Number(b.allowed) - Number(a.allowed) || a.name.localeCompare(b.name));
}

/** Which visit pickers a job's stage shows. Ready Check up to its completion; install day from scheduling to evidence. */
export function visitsForStage(stage: string | null | undefined): VisitKind[] {
  const s = stage ?? "";
  if (["installation_scheduling", "installation_booked", "evidence_outstanding"].includes(s)) return ["install"];
  if (["new_enquiry", "eligibility_review", "preliminary_estimate_ready", "ready_check_awaiting_acceptance", "ready_check_awaiting_payment", "ready_check_ready_to_schedule", "ready_check_scheduled"].includes(s)) return ["ready_check"];
  return [];
}

/** The booking kinds each visit covers (daily text + form lookup). Electrician visits are never allocated this way. */
export function visitKindOfBooking(bookingKind: string): VisitKind | null {
  if (bookingKind === "ready_check") return "ready_check";
  if (bookingKind === "installation") return "install";
  return null;
}

export type VisitAllocationDetails = { visit: VisitKind; worker_id: string; worker_name: string; by: string; mitti_user_id: string | null; audit_id: string | null; form: "reassigned" | "none" };
export function allocationDetails(d: VisitAllocationDetails): VisitAllocationDetails { return d; }

/** Latest `visit_allocated` event for one visit kind (append-only history; the newest row is the current allocation). */
export function currentAllocation(events: { event_type: string; details: unknown; created_at: string }[], kind: VisitKind): VisitAllocationDetails | null {
  const rows = events.filter((e) => e.event_type === VISIT_ALLOCATED_EVENT && (e.details as { visit?: string } | null)?.visit === kind)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const d = rows[0]?.details as VisitAllocationDetails | undefined;
  return d && typeof d.worker_id === "string" ? d : null;
}

// ---------- daily 6:30am text recipient ----------
export type TextRecipient = { key: string; name: string; phone: string | null; who: "allocated" | "owner"; note: string | null };
/** Allocated person's mobile when allocated and they have one; otherwise the business owner as today (noted). */
export function dailyTextRecipient(i: { allocated: { workerId: string; name: string; mobile: string | null } | null; owner: { name: string; phone: string | null } }): TextRecipient {
  if (i.allocated) {
    if (i.allocated.mobile) return { key: `w:${i.allocated.workerId}`, name: i.allocated.name, phone: i.allocated.mobile, who: "allocated", note: null };
    return { key: "owner", name: i.owner.name, phone: i.owner.phone, who: "owner", note: `${i.allocated.name} has no mobile on file – sent to the business owner instead` };
  }
  return { key: "owner", name: i.owner.name, phone: i.owner.phone, who: "owner", note: null };
}
/** send_key per business, day and recipient. The owner keeps the legacy key so a deploy never re-sends today's text. */
export function dailySendKey(kind: "daily" | "update" | "skip", businessId: string, date: string, recipientKey: string, sig = ""): string {
  const base = kind === "skip" ? `skip:${businessId}:${date}` : `${kind}:${businessId}:${date}`;
  return `${base}${recipientKey === "owner" ? "" : `:${recipientKey}`}${sig ? `:${sig}` : ""}`;
}

/** The one line shown when the person has no Mitti user under the business yet. */
export function addInMittiFirst(name: string, email: string | null): string {
  return `${name} isn't in Mitti yet${email ? ` as ${email}` : ""}. Add them in Mitti first (Business owner does it in Mitti), then allocate.`;
}
