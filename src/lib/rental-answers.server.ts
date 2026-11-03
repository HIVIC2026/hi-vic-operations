// Task 19: read (and, for the office, correct) the rental answers. The owner's answers live in the latest
// `quick_taps_answered` event's details (`answers.rental`); an office correction is a newer `rental_answers_corrected`
// event of the same shape; the latest event that carries rental answers wins. A read failure throws (callers must not
// treat "could not read" as "not rented"). No SQL.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { QUICK_TAPS_ANSWERED_EVENT } from "./quick-taps.core";
import {
  RENTAL_ANSWERS_CORRECTED_EVENT, accessPersonOf, buildRentalAnswers, rentalAnswersFromTaps, rentalAnswersProblems, tenantOf,
  type AccessPerson, type RentalAnswers, type RentalAnswersInput, type TenantContact,
} from "./rental-answers.core";

/** `null` = never asked (an old tap, or the questions were off). */
export async function rentalAnswersFor(jobId: string): Promise<RentalAnswers | null> {
  const { data, error } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId)
    .in("event_type", [QUICK_TAPS_ANSWERED_EVENT, RENTAL_ANSWERS_CORRECTED_EVENT]).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(`Could not read the rental answers: ${error.message}`);
  for (const row of (data ?? []) as { details: unknown }[]) {
    const found = rentalAnswersFromTaps(row.details);
    if (found) return found;
  }
  return null;
}

/** Who lets us in when it is not the owner; null when the owner lives there, the owner lets us in, or not asked. */
export async function accessPersonFor(jobId: string): Promise<AccessPerson | null> { return accessPersonOf(await rentalAnswersFor(jobId)); }
export async function tenantFor(jobId: string): Promise<TenantContact | null> { return tenantOf(await rentalAnswersFor(jobId)); }

/** Office correction: a new `rental_answers_corrected` event (the earlier answers stay as history). The caller checks
 *  the office user's rights. */
export async function correctRentalAnswers(jobId: string, actorId: string, input: RentalAnswersInput): Promise<RentalAnswers> {
  const problems = rentalAnswersProblems(input);
  if (problems.length) { const { WorkflowError } = await import("./workflow.server"); throw new WorkflowError(problems.join(" ")); }
  const { data: job, error } = await admin.from("jobs").select("owners(full_name, phone)").eq("id", jobId).maybeSingle();
  if (error) throw new Error(`Could not read the owner: ${error.message}`);
  const owner = (job as { owners?: { full_name: string | null; phone: string | null } | null } | null)?.owners ?? null;
  const rental = buildRentalAnswers(input, { name: owner?.full_name ?? null, phone: owner?.phone ?? null });
  const { logEvent } = await import("./workflow.server");
  await logEvent(jobId, actorId, RENTAL_ANSWERS_CORRECTED_EVENT, rental.rented ? "Office corrected the rental answers: rented" : "Office corrected the rental answers: owner lives there", { answers: { rental } }, { internal: true });
  return rental;
}
