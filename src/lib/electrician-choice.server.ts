// Decision 289 (Jo 25 Oct 2026): the job's electrician choice, recorded once at Add a job (or defaulted on bulk upload)
// as the append-only `electrician_choice_set` workflow event, and read back by the quote pipeline. Read-only apart from
// `recordElectricianChoice`; no Mitti, no senders (this module sits on the autoAdvance graph through installer-quote).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import { ELECTRICIAN_CHOICE_EVENT, electricianChoiceFromEvent, electricianChoiceRecord, electricianChoiceSummary, savedElectricianChoiceProblem, savedUsualDefault, type ElectricianChoice, type ElectricianChoiceRecord } from "./electrician-choice.core";

/** Latest recorded choice on the job, or null when none was ever recorded (jobs added before 25 Oct 2026). */
export async function readElectricianChoice(jobId: string): Promise<ElectricianChoice | null> {
  const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", ELECTRICIAN_CHOICE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("The electrician choice could not be read.");
  return electricianChoiceFromEvent(data?.details);
}

/** `readElectricianChoice` for many jobs in one read: each job's latest recorded choice (missing = none recorded). */
export async function readElectricianChoices(jobIds: string[]): Promise<Map<string, ElectricianChoice | null>> {
  const out = new Map<string, ElectricianChoice | null>();
  const ids = [...new Set(jobIds)];
  if (!ids.length) return out;
  const { data, error } = await admin.from("workflow_events").select("job_id, details, created_at").in("job_id", ids).eq("event_type", ELECTRICIAN_CHOICE_EVENT).order("created_at", { ascending: false });
  if (error) throw new WorkflowError("The electrician choice could not be read.");
  for (const e of data ?? []) if (e.job_id && !out.has(e.job_id)) out.set(e.job_id, electricianChoiceFromEvent(e.details)); // newest first
  return out;
}

/** Records the choice (validated against the business's saved usual electrician). `choice` null = the default rule
 *  (usual when saved, else Home Insulation Victoria's) — bulk upload and legacy callers. Append-only; never sends. */
export async function recordElectricianChoice(jobId: string, businessId: string, actorId: string | null, choice: ElectricianChoice | null | undefined, source: ElectricianChoiceRecord["source"]): Promise<ElectricianChoiceRecord> {
  const usual = (await (await import("./usual-electrician.server")).readUsualElectrician(businessId)).electrician;
  const chosen = choice ?? savedUsualDefault(usual);
  // Saved-electrician check only: Add a job checks "finished signing up" before it saves anything (rule 3).
  const problem = savedElectricianChoiceProblem(chosen, usual);
  if (problem) throw new WorkflowError(problem);
  const record = electricianChoiceRecord(chosen, usual, choice ? source : "default");
  await logEvent(jobId, actorId, ELECTRICIAN_CHOICE_EVENT, electricianChoiceSummary(record), { ...record, business_id: businessId, declared_not_verified: true }, { internal: true });
  return record;
}
