// "Site conditions differ" review hold (approved two-route brief, Jo 20 Oct). Append-only events; pure decision.
// An installer or office raises it when what is found onsite differs from what the job/quote was based on.
// While open it blocks every owner-quote release/approve/accept (via intake readiness) and the start of works.
// Only the office clears it. It never changes an accepted amount — scope changes go through the existing variation flow.
export const SITE_HOLD_RAISED = "site_conditions_differ_raised";
export const SITE_HOLD_CLEARED = "site_conditions_differ_cleared";
export const SITE_HOLD_BLOCKER = "Site conditions differ — office review required before the quote or works can continue";

export type SiteHoldEvent = { event_type: string; created_at: string; details?: { note?: unknown } | null };
export type SiteHold = { open: boolean; note: string | null; raisedAt: string | null };

/** Latest raise/clear wins; ties resolve to OPEN (fail closed). */
export function siteConditionsHold(events: SiteHoldEvent[]): SiteHold {
  const rel = events.filter((e) => e.event_type === SITE_HOLD_RAISED || e.event_type === SITE_HOLD_CLEARED)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.event_type === SITE_HOLD_RAISED ? -1 : 1));
  const last = rel[0];
  if (!last || last.event_type === SITE_HOLD_CLEARED) return { open: false, note: null, raisedAt: null };
  const n = last.details?.note;
  return { open: true, note: typeof n === "string" && n.trim() ? n.trim() : null, raisedAt: last.created_at };
}

export function siteHoldNoteProblem(note: string): string | null {
  return note.trim().length < 5 ? "Describe what is different onsite (at least a few words)." : null;
}
