// PRE-LAUNCH CUSTOMER COMMUNICATIONS LOCK. Every outbound email/SMS/notification/customer request
// MUST call assertCustomerCommsEnabled() first. Default is locked (workflow_settings.customer_comms_enabled = false).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";

export const COMMS_LOCKED_MESSAGE = "PRE-LAUNCH: customer communications are disabled – nothing was sent to the customer or trade.";

/** Fails closed: a missing setting or read error counts as locked. */
export async function customerCommsEnabled(): Promise<boolean> {
  const { data, error } = await admin.from("workflow_settings").select("customer_comms_enabled").limit(1).maybeSingle();
  if (error || !data) return false;
  return data.customer_comms_enabled === true;
}

export async function assertCustomerCommsEnabled(what: string) {
  if (!(await customerCommsEnabled())) throw new WorkflowError(`${COMMS_LOCKED_MESSAGE} (${what})`);
}
