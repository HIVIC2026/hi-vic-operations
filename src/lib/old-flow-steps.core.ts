// Part 3 Task 16 (Jo 2 Nov 2026): the old pre-acceptance steps being retired, and how to tell which REAL jobs are
// still mid-way through one. Pure: no network, no database. Used by scripts/old-flow-inflight-count.ts (read-only)
// and tests/old-flow-removed-p3.test.ts. A job that is mid-way through one of these steps keeps its old screen
// (OwnerReadyCheckTimes / OwnerRunTime show themselves only for such a job); nothing new is started on them.
// Part 7 Task 9 adds OLD_FLOW_STEPS_P7 (the trade side: offers, runs, owner-suggested days) — same script, same test shape.
export type OldFlowStep = { step: string; stages: string[]; events: string[]; tables: string[] };
export const OLD_FLOW_STEPS_P3: OldFlowStep[] = [
  {
    step: "owner picking Ready Check times",
    // Not a stage of its own: an installer-offered Ready Check time (appointment_proposals kind ready_check, note
    // ready_check_time, still proposed, starts in the future) waiting for the owner. The offer is logged as this event.
    stages: [],
    events: ["ready_check_times_offered"],
    tables: ["appointment_proposals"],
  },
  {
    step: "owner confirming a run window",
    // Run slot proposed (text sent with the window) and not yet confirmed, released, cancelled or failed.
    stages: [],
    events: ["run_slot_proposed"],
    tables: ["workflow_events"],
  },
];

// Part 7 Task 9 (Jo 2 Nov 2026): the trade-side steps whose messages are gone (job offer text/email, "You've got a run",
// "owner suggested other days", "Booked: Ready Check"). A REAL job still at one of these is waiting on a trade who will
// never be told again — the office finishes it by hand (Jo, 3 Nov 2026: HV-3682 and HV-3542).
export const OLD_FLOW_STEPS_P7: OldFlowStep[] = [
  {
    step: "trade offer waiting for a reply",
    // A pending, unexpired partner_offers row (any kind): the installer's offer page and the offer texts/emails are gone.
    stages: [],
    events: [],
    tables: ["partner_offers"],
  },
  {
    step: "installer run still open",
    // A run (run_offered claims) that is still offered or answered — not declined, expired or ended.
    stages: [],
    events: ["run_offered"],
    tables: ["workflow_events"],
  },
  {
    step: "owner-suggested Ready Check days waiting for the installer",
    // Owner-proposed ready_check days (appointment_proposals, note ready_check_time, proposer_role owner) still proposed and ahead.
    stages: [],
    events: ["ready_check_days_suggested"],
    tables: ["appointment_proposals"],
  },
];

export type PendingOfferRow = { job_id: string; status: string; expires_at: string | null };
/** Jobs with a trade offer nobody can answer any more: pending and not past its expiry. */
export function jobsWithPendingOffer(rows: readonly PendingOfferRow[], now: Date): string[] {
  const t = now.getTime();
  return [...new Set(rows.filter((r) => r.status === "pending" && (!r.expires_at || Date.parse(r.expires_at) > t)).map((r) => r.job_id))];
}

export type OwnerDayRow = { job_id: string; status: string; starts_at: string; proposer_role: string };
/** Jobs whose owner suggested Ready Check days the installer was never told about (still proposed, in the future). */
export function jobsWithOwnerSuggestedDays(rows: readonly OwnerDayRow[], now: Date): string[] {
  const t = now.getTime();
  return [...new Set(rows.filter((r) => r.proposer_role === "owner" && r.status === "proposed" && Date.parse(r.starts_at) > t).map((r) => r.job_id))];
}

export const RUN_SLOT_END_EVENTS = ["run_slot_confirmed", "run_slot_released", "run_slot_cancelled", "run_slot_confirm_failed"] as const;

export type OpenTimeRow = { job_id: string; status: string; starts_at: string };
/** Jobs with an installer-offered Ready Check time still open (proposed and in the future). */
export function jobsPickingReadyCheckTimes(rows: readonly OpenTimeRow[], now: Date): string[] {
  const t = now.getTime();
  return [...new Set(rows.filter((r) => r.status === "proposed" && Date.parse(r.starts_at) > t).map((r) => r.job_id))];
}

export type SlotEventRow = { job_id: string; event_type: string; created_at: string };
/** Jobs whose latest run-slot event is a proposal (the owner has been offered a window and nothing closed it). */
export function jobsConfirmingRunWindow(events: readonly SlotEventRow[]): string[] {
  const latest = new Map<string, SlotEventRow>();
  for (const e of events) {
    if (e.event_type !== "run_slot_proposed" && !(RUN_SLOT_END_EVENTS as readonly string[]).includes(e.event_type)) continue;
    const prev = latest.get(e.job_id);
    if (!prev || e.created_at >= prev.created_at) latest.set(e.job_id, e);
  }
  return [...latest.values()].filter((e) => e.event_type === "run_slot_proposed").map((e) => e.job_id);
}
