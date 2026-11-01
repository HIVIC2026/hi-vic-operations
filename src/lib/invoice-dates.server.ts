// Install-date → invoice due date flags. Local database only: never calls Xero. The Xero update itself is
// sent later by xero.server only when XERO_DUE_DATE_UPDATES_ENABLED (flagged `xero_update_pending`).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { assertHivicJob, melbourneDate } from "./xero.core";
import { installDueDatePatch, type InvoiceRow } from "./invoice.lifecycle";

async function hivicInvoice(jobId: string): Promise<InvoiceRow | null> {
  const { data: j } = await admin.from("jobs").select("business_unit").eq("id", jobId).maybeSingle();
  assertHivicJob(j);
  const { data } = await admin.from("invoices").select("*").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data as unknown as InvoiceRow) ?? null;
}

async function patchInvoice(id: string, patch: Partial<InvoiceRow>) {
  const { error } = await admin.from("invoices").update(patch as never).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function setInstallDueDate(jobId: string, startIso: string, actorId: string) {
  // Q21: booking does not start the balance clock. Keep this entry point for existing booking callers.
  const {data:job,error}=await admin.from('jobs').select('installation_completed_at').eq('id',jobId).maybeSingle();
  if(error)throw Error('Could not read installation completion.');
  if(!job?.installation_completed_at)return;
  await setCompletedBalanceDueDate(jobId,job.installation_completed_at,actorId);
}
export async function setCompletedBalanceDueDate(jobId:string,completedAt:string,actorId:string|null){
  const inv = await hivicInvoice(jobId);
  if (!inv) return;
  const end=(await import('./balance-q21.core')).balanceDueAt(completedAt);if(!end)return;
  const due = melbourneDate(end);
  const patch = installDueDatePatch(inv, due);
  if (!patch) return;
  await patchInvoice(inv.id, patch);
  await logEvent(jobId, actorId, "balance_due_set", `Remaining balance due 7 days after recorded install completion (${due})${patch.xero_update_pending ? " – Xero due date update pending" : ""}`, { invoice_id: inv.id });
}

