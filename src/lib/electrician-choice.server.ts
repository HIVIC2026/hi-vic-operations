// Decision 289 (Jo 25 Oct 2026): the job's electrician choice, recorded once at Add a job (or defaulted on bulk upload)
// as the append-only `electrician_choice_set` workflow event, and read back by the quote pipeline. Read-only apart from
// `recordElectricianChoice`; no Mitti, no senders (this module sits on the autoAdvance graph through installer-quote).
import { jobAdmin as admin } from "./job-facts.server"; // speed (Task 11): the admin client; inside the job page bundle it answers from the job's rows
import { WorkflowError, logEvent } from "./workflow.server";
import { ELECTRICIAN_CHOICE_EVENT, defaultElectricianChoice, electricianChoiceFromEvent, electricianChoiceProblem, electricianChoiceRecord, electricianChoiceSummary, teamElectricianChoiceRecord, teamWorkerFromEvent, type ElectricianChoice, type ElectricianChoiceRecord } from "./electrician-choice.core";

/** Latest recorded choice on the job, or null when none was ever recorded (jobs added before 25 Oct 2026). */
export async function readElectricianChoice(jobId: string): Promise<ElectricianChoice | null> {
  return (await readElectricianChoiceRecord(jobId)).choice;
}
/** The latest choice AND the Team electrician it names (join ruling, 4 Nov 2026: Add a job records the picked Team worker). */
export async function readElectricianChoiceRecord(jobId: string): Promise<{ choice: ElectricianChoice | null; workerId: string | null }> {
  const { data, error } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", ELECTRICIAN_CHOICE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("The electrician choice could not be read.");
  return { choice: electricianChoiceFromEvent(data?.details), workerId: teamWorkerFromEvent(data?.details) };
}

/** Records the choice (validated against the business's saved usual electrician). `choice` null = the default rule
 *  (usual when saved, else Home Insulation Victoria's) — bulk upload and legacy callers. Append-only; never sends. */
export async function recordElectricianChoice(jobId: string, businessId: string, actorId: string | null, choice: ElectricianChoice | null | undefined, source: ElectricianChoiceRecord["source"], opts: { /** Part 2b: one of the installer's approved, linked electricians was picked by name (the caller checked the list); recorded as "usual" naming THEM. */ picked?: { name: string } | null; /** Join ruling (4 Nov 2026): the verified Team electrician picked at Add a job (the caller checked the Team list); recorded as "usual" naming THEM. */ teamWorker?: { id: string; name: string; licence?: string | null } | null } = {}): Promise<ElectricianChoiceRecord | { choice: null; usual_name: null; usual_licence: null; source: ElectricianChoiceRecord["source"] }> {
  if (opts.teamWorker) {
    const record = teamElectricianChoiceRecord(opts.teamWorker, source);
    await logEvent(jobId, actorId, ELECTRICIAN_CHOICE_EVENT, electricianChoiceSummary(record), { ...record, business_id: businessId, declared_not_verified: false }, { internal: true });
    return record;
  }
  if (opts.picked) {
    const record: ElectricianChoiceRecord = { choice: "usual", usual_name: opts.picked.name, usual_licence: null, source };
    await logEvent(jobId, actorId, ELECTRICIAN_CHOICE_EVENT, electricianChoiceSummary(record), { ...record, business_id: businessId, declared_not_verified: false }, { internal: true });
    return record;
  }
  const status = await (await import("./usual-electrician.server")).readUsualElectricianStatus(businessId);
  const usual = status.onboarded ? status.electrician : null;
  const chosen = choice ?? defaultElectricianChoice(usual);
  // Upload jobs with no approved usual electrician stays undecided, never defaults to HIV.
  if (!chosen && !choice && source === "bulk_upload") {
    await logEvent(jobId, actorId, "electrician_to_be_arranged", "Installer to choose electrician", { business_id: businessId }, { internal: true });
    return { choice: null, usual_name: null, usual_licence: null, source };
  }
  const problem = electricianChoiceProblem(chosen, usual);
  if (problem) throw new WorkflowError(problem);
  if (!chosen) throw new WorkflowError("Choose your own electrician.");
  const record = electricianChoiceRecord(chosen, usual, choice ? source : "default");
  await logEvent(jobId, actorId, ELECTRICIAN_CHOICE_EVENT, electricianChoiceSummary(record), { ...record, business_id: businessId, declared_not_verified: true }, { internal: true });
  return record;
}
