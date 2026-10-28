// A6 (installer pages part 1, Jo 29 Oct 2026): Add a job's one-transaction save. `add_installer_job` (staged in
// docs/pending-migrations/add-installer-job-atomic.sql) writes owner, property, job, assignment, consent and events
// together, keyed by the phone's request key; until it is applied the caller falls back to the step-by-step save.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import type { AddInstallerJobPayload } from "./add-installer-job.core";

/** The job an earlier tap with this request key already saved for this business, if any. */
export async function findAddedJob(requestKey: string, businessId: string): Promise<{ jobId: string; jobNumber: string } | null> {
  const { data, error } = await admin.from("jobs").select("id, job_number").eq("external_enquiry_id", `onsite:${requestKey}`).eq("originating_installer_business_id", businessId).eq("channel", "installer_sourced").maybeSingle();
  if (error) throw new WorkflowError("We couldn't check whether this job was already saved. Please try again.");
  return data ? { jobId: data.id, jobNumber: data.job_number } : null;
}

/** Saves everything in one transaction. `created: false` = this request key was already saved (nothing new written).
 *  "not_deployed" = the function isn't live yet; the caller uses the step-by-step save. */
export async function addInstallerJobAtomic(p: AddInstallerJobPayload): Promise<{ jobId: string; jobNumber: string; created: boolean } | "not_deployed"> {
  const { data, error } = await admin.rpc("add_installer_job" as never, { _payload: p } as never);
  if (error) {
    const { isMissingDbObject } = await import("./schema-compat.core");
    if (isMissingDbObject(error)) { console.warn("add_installer_job not deployed (staged add-installer-job-atomic.sql); using the step-by-step save"); return "not_deployed"; }
    throw new WorkflowError((error as { message?: string }).message ?? "Job could not be saved.");
  }
  const row = (Array.isArray(data) ? data[0] : data) as { job_id?: string; job_number?: string; created?: boolean } | null | undefined;
  if (!row?.job_id || !row.job_number) throw new WorkflowError("Job could not be saved.");
  return { jobId: row.job_id, jobNumber: row.job_number, created: row.created === true };
}
