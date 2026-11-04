import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { CUSTOMER_AGREEMENT_KEY } from "./customer-agreement.core";

/** The approved, active Customer Agreement wording, or null when none is set. */
export async function activeCustomerAgreement(): Promise<{ version: string; body: string; approvedAt: string | null } | null> {
  const { data } = await admin
    .from("compliance_templates")
    .select("version, body, approved_at")
    .eq("template_key", CUSTOMER_AGREEMENT_KEY)
    .eq("approved", true)
    .eq("is_active", true)
    .maybeSingle();
  return data ? { version: data.version, body: data.body, approvedAt: data.approved_at } : null;
}
