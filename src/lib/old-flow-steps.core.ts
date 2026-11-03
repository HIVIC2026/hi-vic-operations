// Part 3 Task 16 (Jo 2 Nov 2026): the old pre-acceptance steps being retired, and how to tell which REAL jobs are
// still mid-way through one. Pure: no network, no database. Used by scripts/old-flow-inflight-count.ts (read-only)
// and tests/old-flow-removed-p3.test.ts. A job that is mid-way through one of these steps keeps its old screen
// (OwnerReadyCheckTimes / OwnerRunTime show themselves only for such a job); nothing new is started on them.
export const OLD_FLOW_STEPS_P3: { step: string; stages: string[]; events: string[] }[] = [
  {
    step: "owner picking Ready Check times",
    // Not a stage of its own: an installer-offered Ready Check time (appointment_proposals kind ready_check, note
    // ready_check_time, still proposed, starts in the future) waiting for the owner. The offer is logged as this event.
    stages: [],
    events: ["ready_check_times_offered"],
  },
  {
    step: "owner confirming a run window",
    // Run slot proposed (text sent with the window) and not yet confirmed, released, cancelled or failed.
    stages: [],
    events: ["run_slot_proposed"],
  },
];

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

// ---------------------------------------------------------------------------------------------------------------
// Part 4 Task 14 (Jo 2 Nov 2026): the old AFTER-acceptance steps being retired (electrician offers, owner picking
// safety check times, the HIV electrical fixes quote and its times, the owner picking install days). Same shape and
// use as OLD_FLOW_STEPS_P3: a REAL job mid-way through one keeps its old screen until it moves on; nothing new is
// started on them (the senders are gone). Pure: no network, no database.
export const OLD_FLOW_STEPS_P4: { step: string; stages: string[]; events: string[] }[] = [
  {
    step: "electrician offer open",
    // partner_offers kind piesa, status pending, not expired: an electrician was offered the safety check job (text + E1).
    stages: [],
    events: ["electrician_offer_email"],
  },
  {
    step: "owner picking safety check times",
    // appointment_proposals kind assessment, proposer electrician, still proposed, in the future (decision 333 rows: no
    // piesa_window_round, not an electrician fixes window, not an install day) — the owner was emailed O26 to pick one.
    stages: [],
    events: ["piesa_times_offered"],
  },
  {
    step: "owner approving an electrical fixes quote",
    // quotes kind rectification, status issued (O29 sent, the owner has not said yes or no).
    stages: ["awaiting_owner_rectification_approval", "electrical_variation_pending"],
    events: ["rectification_quote_issued"],
  },
  {
    step: "owner picking a fixes time",
    // appointment_proposals kind rectification, electrician_window, still proposed and in the future (the electrician's
    // fixes times the owner picks from after paying).
    stages: ["rectification_scheduling"],
    events: ["rectification_windows_given"],
  },
  {
    step: "owner picking install days",
    // appointment_proposals install_day, proposer installer, still proposed and in the future (O33 sent).
    stages: ["installation_scheduling"],
    events: ["install_days_offered_by_installer"],
  },
];

const future = (iso: string, now: Date) => Date.parse(iso) > now.getTime();
const uniq = (ids: string[]) => [...new Set(ids)];

export type OfferRow = { job_id: string; status: string; expires_at: string | null };
/** Jobs with a pending electrician (PIESA) offer that has not expired. */
export function jobsWithElectricianOfferOpen(rows: readonly OfferRow[], now: Date): string[] {
  return uniq(rows.filter((r) => r.status === "pending" && (!r.expires_at || future(r.expires_at, now))).map((r) => r.job_id));
}

export type PiesaTimeRow = { job_id: string; proposer_role: string | null; status: string; starts_at: string; piesa_window_round: number | null; electrician_window: boolean | null; install_day: boolean | null };
/** Jobs where an electrician-offered safety check time is still open for the owner (piesa-times.core isPiesaTimeRow rule). */
export function jobsPickingPiesaTimes(rows: readonly PiesaTimeRow[], now: Date): string[] {
  return uniq(rows.filter((r) => r.proposer_role === "electrician" && r.status === "proposed" && future(r.starts_at, now) && r.piesa_window_round == null && !r.electrician_window && !r.install_day).map((r) => r.job_id));
}

export type QuoteRow = { job_id: string; kind: string; status: string };
/** Jobs with an issued (unanswered) electrical fixes quote. */
export function jobsApprovingFixesQuote(rows: readonly QuoteRow[]): string[] {
  return uniq(rows.filter((r) => r.kind === "rectification" && r.status === "issued").map((r) => r.job_id));
}

export type FixesWindowRow = { job_id: string; status: string; starts_at: string };
/** Jobs with an electrician fixes window still open for the owner to pick. */
export function jobsPickingFixesTime(rows: readonly FixesWindowRow[], now: Date): string[] {
  return uniq(rows.filter((r) => r.status === "proposed" && future(r.starts_at, now)).map((r) => r.job_id));
}

export type InstallDayOfferRow = { job_id: string; proposer_role: string | null; status: string; starts_at: string };
/** Jobs where the installer's offered install days are still open for the owner. */
export function jobsPickingInstallDays(rows: readonly InstallDayOfferRow[], now: Date): string[] {
  return uniq(rows.filter((r) => r.proposer_role === "installer" && r.status === "proposed" && future(r.starts_at, now)).map((r) => r.job_id));
}
