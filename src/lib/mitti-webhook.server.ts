// Mitti instant notice: Mitti says one form changed; the portal re-syncs that one job straight away.
// The notice body is never trusted for answers: syncMittiAssessment re-reads the form itself.
// Switch: workflow_settings.mitti_instant_notice_enabled (default off). A read error or missing column = off.
// Only forms the portal made, on jobs the 15-minute pull still syncs: anything else is ignored. Logs ids and error message only.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { MITTI_SYNC_SCOPE_SELECT, inMittiSyncScope } from "./mitti-sync-scope.core";

export type MittiNoticeResult = { action: "ignored" | "off" | "synced" | "failed" };

async function noticeSwitchOn(): Promise<boolean> {
  const { data, error } = await admin.from("workflow_settings").select("mitti_instant_notice_enabled").eq("id", 1).maybeSingle();
  if (error || !data) return false;
  return (data as { mitti_instant_notice_enabled?: boolean | null }).mitti_instant_notice_enabled === true;
}

// Only jobs the 15-minute pull would sync (same scope, mitti-sync-scope.core.ts); anything else is ignored.
async function jobForAudit(auditId: string): Promise<string | null> {
  const { data: a } = await inMittiSyncScope(admin.from("assessments").select(MITTI_SYNC_SCOPE_SELECT).eq("external_mitti_id", auditId)).limit(1).maybeSingle();
  if (a?.job_id) return String(a.job_id);
  const { data: m } = await inMittiSyncScope(admin.from("ceiling_measurements").select(MITTI_SYNC_SCOPE_SELECT).eq("external_source", "mitti").eq("is_current", true).eq("external_id", auditId)).limit(1).maybeSingle();
  return m?.job_id ? String(m.job_id) : null;
}

export async function handleMittiNotice(auditId: string): Promise<MittiNoticeResult> {
  if (!(await noticeSwitchOn())) return { action: "off" };
  const jobId = await jobForAudit(auditId);
  if (!jobId) return { action: "ignored" };
  try {
    const { syncMittiAssessment } = await import("./mitti.server");
    await syncMittiAssessment(jobId, null);
    return { action: "synced" };
  } catch (e) {
    console.error("mitti notice: sync failed", jobId, e instanceof Error ? e.message : String(e));
    return { action: "failed" };
  }
}
