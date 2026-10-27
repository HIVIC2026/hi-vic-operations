import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { completedRefreshPlan, completedQuoteCanRedraft } from "./mitti-completed-refresh.core";
import { parseAudit, splitPatch, validateStoredMittiAudit } from "./mitti.core";
import { sameMittiTemplateId } from "./mitti-identity.core";
import { logEvent } from "./workflow.server";

/** Same stored form only; no senders, completion changes or accepted-measurement overwrites. */
export async function refreshCompletedReadyCheck(jobId: string, auditId: string, audit: unknown) {
  const [{ data: m, error: me }, { data: j, error: je }, { data: ws, error: we }] = await Promise.all([
    admin.from("ceiling_measurements").select("id,status,external_source,external_id,raw_snapshot,accepted_by,verified_area_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("jobs").select("job_number").eq("id", jobId).single(),
    admin.from("workflow_settings").select("mitti_ready_check_template_id,mitti_ready_check_priced_template_id").eq("id", 1).single(),
  ]);
  if (me || je || we) throw new Error("Completed Ready Check facts could not be read");
  if (!m || !j || !ws) return false;
  const parsed = parseAudit(audit);
  const template = [ws.mitti_ready_check_template_id, ws.mitti_ready_check_priced_template_id].find(t => t && sameMittiTemplateId(t, parsed.templateId));
  if (!template) throw new Error("Completed Ready Check template does not match");
  validateStoredMittiAudit(audit, { storedAuditId: auditId, jobNumber: j.job_number ?? "", templateId: template });
  const patch = completedRefreshPlan({ current: m, auditId, completed: parsed.completed, snapshot: parsed.snapshot, values: splitPatch(parsed.patch).measure, zones: parsed.areas ?? null });
  if (!patch) return false;
  const { data: updated, error } = await admin.from("ceiling_measurements").update(patch as never).eq("id", m.id).eq("is_current", true).eq("status", "complete").eq("external_source", "mitti").eq("external_id", auditId).is("accepted_by", null).is("verified_area_m2", null).select("id").maybeSingle();
  if (error) throw new Error("Completed Ready Check edits could not be saved");
  if (!updated) return false;
  await logEvent(jobId, null, "mitti_completed_measurement_refreshed", "Edited completed Ready Check measurements refreshed from Mitti", { measurement_id: m.id, audit_id: auditId, modified_at: parsed.modifiedAt, measurement: splitPatch(parsed.patch).measure }, { internal: true });
  return true;
}

export async function completedDraftAllowed(jobId: string) {
  const { data: quotes, error } = await admin.from("quotes").select("status,sent_at,release_state").eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted"]);
  if (error) throw new Error("Quote status could not be checked");
  return completedQuoteCanRedraft(quotes ?? []);
}