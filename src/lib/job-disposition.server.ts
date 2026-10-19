// Office hold / cancel disposition (the reviewed, audited path used by the single-job "Put on hold" / "Cancel"
// action). Shared with the bulk action so bulk hold/cancel no longer go through transition(), which never allows
// these targets. Server-only; callers must have checked requireAdmin.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError, logEvent } from "./workflow.server";
import type { Stage } from "./workflow";

export async function applyHoldOrCancel(jobId: string, action: "hold" | "cancel", reason: string, actorId: string, details: Record<string, unknown> = {}) {
  if (!reason || reason.trim().length < 3) throw new WorkflowError("A reason is required.");
  const { data: job } = await admin.from("jobs").select("stage, prior_stage").eq("id", jobId).single();
  if (!job) throw new WorkflowError("Not found");
  const to: Stage = action === "hold" ? "on_hold" : "cancelled";
  const { error } = await admin.from("jobs").update({ stage: to, prior_stage: job.stage === "on_hold" ? job.prior_stage : job.stage, hold_reason: action === "hold" ? reason : null, cancelled_reason: action === "cancel" ? reason : null }).eq("id", jobId);
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, "stage_changed", `${to === "on_hold" ? "Put on hold" : "Cancelled"}: ${reason}`, details, { from: job.stage, to });
}
