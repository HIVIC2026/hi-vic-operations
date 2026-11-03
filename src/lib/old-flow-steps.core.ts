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
