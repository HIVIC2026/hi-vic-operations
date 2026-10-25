// Decision 289 (Jo 25 Oct 2026): the job's electrician choice, recorded once at Add a job (or defaulted on bulk upload)
// as the append-only `electrician_choice_set` workflow event, and read back by the quote pipeline. Read-only apart from
// `recordElectricianChoice`; no Mitti, no senders (this module sits on the autoAdvance graph through installer-quote).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { ELECTRICIAN_CHOICE_EVENT, defaultElectricianChoice, electricianChoiceFromEvent, electricianChoiceProblem, electricianChoiceRecord, electricianChoiceSummary, type ElectricianChoice, type ElectricianChoiceRecord } from "./electrician-choice.core";

/** Latest recorded choice on the job, or null when none was ever recorded (jobs added before 25 Oct 2026). */
export async function readElectricianChoice(jobId: string): Promise<ElectricianChoice | null> {
  const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", ELECTRICIAN_CHOICE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("The electrician choice could not be read.");
  return electricianChoiceFromEvent(data?.details);
}

/** Records the choice (validated against the business's saved usual electrician). `choice` null = the default rule
 *  (usual when saved, else Home Insulation Victoria's) — bulk upload and legacy callers. Append-only; never sends. */
export async function recordElectricianChoice(jobId: string, businessId: string, actorId: string | null, choice: ElectricianChoice | null | undefined, source: ElectricianChoiceRecord["source"]): Promise<ElectricianChoiceRecord> {
  const usual = (await (await import("./usual-electrician.server")).readUsualElectrician(businessId)).electrician;
  const chosen = choice ?? defaultElectricianChoice(usual);
  const problem = electricianChoiceProblem(chosen, usual);
  if (problem) throw new WorkflowError(problem);
  const record = electricianChoiceRecord(chosen, usual, choice ? source : "default");
  await logEvent(jobId, actorId, ELECTRICIAN_CHOICE_EVENT, electricianChoiceSummary(record), { ...record, business_id: businessId, declared_not_verified: true }, { internal: true });
  return record;
}
