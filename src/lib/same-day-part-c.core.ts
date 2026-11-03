// Part 3 Task 4b fix 1 (4 Nov 2026): the same-day Part C record (upgrades done on the safety check visit, Part C on the A3)
// could not be written after Complete PIESA. The PIESA completion stands; the office gets ONE row with the reason until a
// later sync (or the office Complete PIESA press) writes the record. Pure: events in, open row out.
export const SAME_DAY_PART_C_FAILED_EVENT = "same_day_part_c_failed";
/** Written when a retry writes the record after a failure — clears the office row. */
export const SAME_DAY_PART_C_RECOVERED_EVENT = "same_day_part_c_recovered";
/** The stages a stuck same-day record can be retried at: the PIESA is complete and installation scheduling is not reached. */
export const SAME_DAY_PART_C_RETRY_STAGES = ["piesa_complete", "rectification_booked", "assessment_complete", "electrical_variation_pending"] as const;

export const SAME_DAY_PART_C_FAILED_PREFIX = "Same-day Part C record failed — ";
export const sameDayPartCFailedLine = (reason: string) => `${SAME_DAY_PART_C_FAILED_PREFIX}${reason.trim() || "reason not recorded"}`;

type Ev = { event_type: string; created_at: string; details?: Record<string, unknown> | null };
/** Open while the newest failed / recovered event is a failure. */
export function sameDayPartCFailedOpen(events: Ev[]): { at: string; reason: string } | null {
  const last = events.filter((e) => e.event_type === SAME_DAY_PART_C_FAILED_EVENT || e.event_type === SAME_DAY_PART_C_RECOVERED_EVENT)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!last || last.event_type !== SAME_DAY_PART_C_FAILED_EVENT) return null;
  return { at: last.created_at, reason: String(last.details?.["reason"] ?? "") };
}
