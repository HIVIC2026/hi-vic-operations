// Pure rules for cancellations, no-shows, arrivals and per-trade reliability (all four visit types).
// Persistence: visit-events.server.ts. Events are permanent rows in visit_events.

export type VisitKind = "ready_check" | "assessment" | "rectification" | "installation";
export const OWNER_CHANGE_CUTOFF_HOURS = 24;
export const TRADE_NO_SHOW_HOURS = 4;
export const RELIABILITY_DAYS = 90;

export const VISIT_LABEL: Record<VisitKind, string> = { ready_check: "Ready Check", assessment: "PIESA", rectification: "Electrical fixes", installation: "Installation" };

/** Owner may reschedule/cancel by link only when the visit starts more than 24h from now. */
export function ownerChangeAllowed(startIso: string, now: Date = new Date()): boolean {
  return Date.parse(startIso) - now.getTime() > OWNER_CHANGE_CUTOFF_HOURS * 3_600_000;
}

/** Owner misses (no-shows + late changes) for this visit type: the first gets one free rebook, the second goes to the office. */
export function ownerMissOutcome(priorMisses: number): "rebook" | "needs_office" {
  return priorMisses <= 0 ? "rebook" : "needs_office";
}

/** Trade no-show: visit start + 4h passed, no "I've arrived" and no evidence uploaded since the start. */
export function tradeNoShowDue(f: { startIso: string; arrived: boolean; evidenceSinceStart: number }, now: Date = new Date()): boolean {
  return !f.arrived && f.evidenceSinceStart === 0 && now.getTime() - Date.parse(f.startIso) >= TRADE_NO_SHOW_HOURS * 3_600_000;
}

/** "Owner not home" can only be marked once the visit has started. */
export function canMarkOwnerNotHome(startIso: string, now: Date = new Date()) { return now.getTime() >= Date.parse(startIso); }

/** "I've arrived" counts from 2h before the start until the no-show point. */
export function canMarkArrived(startIso: string, now: Date = new Date()) {
  const t = now.getTime(), s = Date.parse(startIso);
  return t >= s - 2 * 3_600_000 && t < s + TRADE_NO_SHOW_HOURS * 3_600_000;
}

/**
 * Where a cancelled visit goes back to, and whether the trade is released.
 * PIESA and Ready Check: owner picks new times and matching runs again (the trade is released).
 * Installation: the quoted installer is never replaced; owner picks new install days for the same installer.
 * Rectification: the electrician supplies the times, so the office arranges new ones (needs attention).
 */
export function reopenPlan(kind: VisitKind): { stage: string; releaseTrade: boolean; office: boolean } {
  switch (kind) {
    case "assessment": return { stage: "piesa_and_install_window_pending", releaseTrade: true, office: false };
    case "ready_check": return { stage: "ready_check_ready_to_schedule", releaseTrade: true, office: false };
    case "installation": return { stage: "installation_scheduling", releaseTrade: false, office: false };
    case "rectification": return { stage: "rectification_scheduling", releaseTrade: false, office: true };
  }
}

/** Booked stage for each visit type (the only stage a booking can be changed from). */
export const BOOKED_STAGE: Record<VisitKind, string> = {
  assessment: "piesa_scheduled", ready_check: "ready_check_scheduled", rectification: "rectification_booked", installation: "installation_booked",
};

export type VisitEventRow = { id: string; business_id: string | null; event: string; counts_against: string; clears_event_id: string | null; created_at: string };

/** Real reliability facts per business over the last 90 days. Cleared no-shows don't count. */
export function reliabilityFacts(rows: VisitEventRow[], now: Date = new Date()) {
  const since = now.getTime() - RELIABILITY_DAYS * 86_400_000;
  const cleared = new Set(rows.filter((r) => r.event === "no_show_cleared" && r.clears_event_id).map((r) => r.clears_event_id!));
  const out = new Map<string, { no_shows: number; evidence_rejections: number; trade_cancellations: number }>();
  for (const r of rows) {
    if (!r.business_id || r.counts_against !== "trade" || Date.parse(r.created_at) < since || cleared.has(r.id)) continue;
    const f = out.get(r.business_id) ?? { no_shows: 0, evidence_rejections: 0, trade_cancellations: 0 };
    if (r.event === "trade_no_show") f.no_shows++;
    else if (r.event === "evidence_rejected") f.evidence_rejections++;
    else if (r.event === "trade_cancelled") f.trade_cancellations++;
    out.set(r.business_id, f);
  }
  return out;
}

/** A trade cancellation counts like a decline: added to the answered offers, not to the accepted ones. */
export function acceptanceWithCancellations(accepted: number, answered: number, cancellations: number): number | null {
  const total = answered + cancellations;
  return total ? accepted / total : null;
}

export type VisitNeedsCode = "owner_no_show_repeat" | "trade_no_show" | "owner_cancelled_visit" | "rectification_new_times";
