import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DeliveryResult } from "./email-delivery.core";

const TABLES = ["customer_email_sends", "job_communications"] as const;

/** Records Resend's delivery result on every row carrying that message id. A bounce is final (never overwritten);
 *  "delivered" only fills an empty result, so a repeated or late event changes nothing. Returns rows changed. */
export async function applyDeliveryResult(p: { providerMessageId: string; result: DeliveryResult; detail: string | null; at: string }): Promise<number> {
  let changed = 0;
  for (const table of TABLES) {
    const q = supabaseAdmin.from(table).update({ delivery_result: p.result, delivery_detail: p.detail, delivery_at: p.at }).eq("provider_message_id", p.providerMessageId);
    const { data, error } = await (p.result === "bounced" ? q.or("delivery_result.is.null,delivery_result.eq.delivered") : q.is("delivery_result", null)).select("id");
    if (error) throw new Error(`Could not record delivery result on ${table}: ${error.message}`);
    changed += data?.length ?? 0;
  }
  return changed;
}
