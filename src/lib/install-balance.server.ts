// Installation booking changes that only update local workflow state.
// This module never connects to Xero or any other external service.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { clearInstallDueDatePatch, type InvoiceRow } from "./invoice.lifecycle";
import { logEvent } from "./workflow.server";
import { HIVIC_BUSINESS_UNIT } from "./xero.core";

/** Installation cancelled: the local final-balance due date returns to pending. */
export async function clearInstallDueDate(jobId: string, actorId: string | null) {
  const { data: job } = await admin.from("jobs").select("business_unit").eq("id", jobId).maybeSingle();
  if (job?.business_unit !== HIVIC_BUSINESS_UNIT) return; // stored lowercase ("hivic"); "HIVIC" never matched
  const { data } = await admin.from("invoices").select("*").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const invoice = (data as unknown as InvoiceRow | null) ?? null;
  if (!invoice) return;
  const patch = clearInstallDueDatePatch(invoice);
  if (!patch) return;
  const { error } = await admin.from("invoices").update(patch as never).eq("id", invoice.id);
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "balance_due_set", "Installation cancelled – final due date pending until rebooked", { invoice_id: invoice.id });
}