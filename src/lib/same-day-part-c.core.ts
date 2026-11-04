// Part 3 Task 4b fix 1 (4 Nov 2026): the same-day Part C record (upgrades done on the safety check visit, Part C on the A3)
// could not be written after Complete PIESA. The PIESA completion stands; the office gets ONE row with the reason, and the
// portal retries it each tick (fix 2: sweepSameDayPartCRetries in the allocation tick). Pure: events in, open row out.
export const SAME_DAY_PART_C_FAILED_EVENT = "same_day_part_c_failed";
/** Written when a retry writes the record after a failure — clears the office row. */
export const SAME_DAY_PART_C_RECOVERED_EVENT = "same_day_part_c_recovered";
/** The stages a stuck same-day record can be retried at: the PIESA is complete and installation scheduling is not reached. */
export const SAME_DAY_PART_C_RETRY_STAGES = ["piesa_complete", "rectification_booked", "assessment_complete", "electrical_variation_pending"] as const;

export const SAME_DAY_PART_C_FAILED_PREFIX = "Same-day Part C record failed — ";
export const sameDayPartCFailedLine = (reason: string) => `${SAME_DAY_PART_C_FAILED_PREFIX}${reason.trim() || "reason not recorded"}`;

type Ev = { event_type: string; created_at: string; details?: Record<string, unknown> | null };
/** The office row's own words: the reason, and that the portal retries it each tick. */
export const sameDayPartCFailedRowLine = (reason: string) => `${sameDayPartCFailedLine(reason)}. The portal retries it each tick.`;
/** Open while the newest failed / recovered event is a failure (a tie goes to the failure). Fix 2: it also closes on its
 *  own once the job is outside the retry stages, or a current post_rectification pass record exists (Part C recorded by
 *  hand, or from an A4 form). An unknown stage (null) keeps it open. */
export function sameDayPartCFailedOpen(events: Ev[], facts: { stage: string | null; postRecord: boolean }): { at: string; reason: string } | null {
  if (facts.postRecord) return null;
  if (facts.stage !== null && !(SAME_DAY_PART_C_RETRY_STAGES as readonly string[]).includes(facts.stage)) return null;
  const last = events.filter((e) => e.event_type === SAME_DAY_PART_C_FAILED_EVENT || e.event_type === SAME_DAY_PART_C_RECOVERED_EVENT)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.event_type === SAME_DAY_PART_C_FAILED_EVENT ? -1 : 0) - (b.event_type === SAME_DAY_PART_C_FAILED_EVENT ? -1 : 0))[0];
  if (!last || last.event_type !== SAME_DAY_PART_C_FAILED_EVENT) return null;
  return { at: last.created_at, reason: String(last.details?.["reason"] ?? "") };
}
