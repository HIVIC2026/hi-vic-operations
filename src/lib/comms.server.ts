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

// ---------- Job communications (single table for every channel) ----------
/** Future email/SMS/WhatsApp connectors implement this and write their results via recordCommunication. None are connected today. */
export interface CommsAdapter { provider: string; send(msg: { to: string[]; subject?: string; body: string }): Promise<{ providerMessageId: string; threadId?: string }>; }
export const CONNECTED_COMMS_ADAPTERS: CommsAdapter[] = [];

export type CommunicationInput = {
  jobId: string; direction: "inbound" | "outbound" | "internal"; channel: "portal" | "email" | "sms" | "phone" | "note" | "system" | "whatsapp" | "other";
  senderText?: string | null; senderUserId?: string | null; recipients?: string[]; subject?: string | null; body: string; provider?: string; providerMessageId?: string | null;
  at?: string | null; visibility: "customer" | "trade" | "internal"; sourceEvent?: string | null; sourceReference?: string | null; createdBy: string | null;
  deliveryStatus?: "recorded" | "queued" | "sent" | "delivered" | "failed" | "blocked_prelaunch" | "received";
};
/** Records a communication. Manual notes of phone calls/external emails are records only – nothing is sent. */
export async function recordCommunication(c: CommunicationInput) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const at = c.at ?? new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("job_communications").insert({
    job_id: c.jobId, direction: c.direction, channel: c.channel, sender_text: c.senderText ?? null, sender_user_id: c.senderUserId ?? null, recipients: c.recipients ?? [],
    subject: c.subject ?? null, body: c.body, provider: c.provider ?? "manual", provider_message_id: c.providerMessageId ?? null,
    sent_at: c.direction === "inbound" ? null : at, received_at: c.direction === "inbound" ? at : null,
    delivery_status: c.deliveryStatus ?? (c.direction === "inbound" ? "received" : "recorded"), visibility: c.visibility,
    source_event: c.sourceEvent ?? null, source_reference: c.sourceReference ?? null, created_by: c.createdBy,
  }).select("id").single();
  if (error) throw new Error(error.message);
  return data.id;
}
