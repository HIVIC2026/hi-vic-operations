// Dormant reminder: default-OFF Mitti switch AND message switch AND approved wording. No preview sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { usualElectricianReminderBody } from "./usual-electrician.core";
import { SET_PASSWORD_BASE } from "./set-password-link.core";

export async function maybeRemindUsualElectrician(jobId: string, auditId: string) {
  const { data: settings } = await admin.from("workflow_settings").select("mitti_auto_quote_enabled").eq("id", 1).maybeSingle();
  if ((settings as { mitti_auto_quote_enabled?: boolean } | null)?.mitti_auto_quote_enabled !== true) return { status: "off" };
  const { data: j } = await admin.from("jobs").select("source, originating_installer_business_id, job_number").eq("id", jobId).maybeSingle();
  if (!j || j.source === "qa_test" || !j.originating_installer_business_id) return { status: "test_or_missing" };
  const { data: b } = await admin.from("businesses").select("signer_mobile, phone").eq("id", j.originating_installer_business_id).maybeSingle();
  return (await import("./sms.server")).sendRealSms({ type: "usual_electrician_missing", jobId, businessId: j.originating_installer_business_id,
    idempotencyKey: `usual-electrician-missing:v1:${jobId}:${auditId}`, to: b?.signer_mobile ?? b?.phone,
    body: usualElectricianReminderBody(j.job_number, `${SET_PASSWORD_BASE}/field/business/details`) });
}