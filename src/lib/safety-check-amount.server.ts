// Decision 302: one read for "what is this quote's upfront safety check?" — the PIESA line, else the setting, else $349.
// Rules in safety-check-amount.core.ts. Read-only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { safetyCheckCentsFor, type SafetyCheckSource } from "./safety-check-amount.core";

export async function quoteSafetyCheck(quoteId: string | null | undefined, settingIncGst?: number | string | null): Promise<{ incGst: number; cents: number; source: SafetyCheckSource }> {
  const setting = settingIncGst === undefined
    ? (await admin.from("workflow_settings").select("safety_check_payment_inc_gst").eq("id", 1).maybeSingle()).data?.safety_check_payment_inc_gst ?? null
    : settingIncGst;
  const { data } = quoteId ? await admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", quoteId).eq("code", "PIESA") : { data: [] };
  const r = safetyCheckCentsFor({ lines: data ?? [], settingIncGst: setting });
  return { incGst: r.cents / 100, cents: r.cents, source: r.source };
}
