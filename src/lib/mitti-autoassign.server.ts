// Auto "Create & assign Mitti assessment" when an approved worker is linked to an installer-sourced job
// that still needs its Ready Check. Never throws: failures become a visible office flag in the job history.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { mittiAccessOf } from "./mitti-membership.core";
import { mittiAutoAssignDecision, type MittiAutoResult } from "./mitti-autoassign.core";
import type { MittiCall } from "./mitti.core";

export async function autoAssignReadyCheckForm(jobId: string, workerId: string, actorId: string | null, call?: MittiCall): Promise<MittiAutoResult> {
  const [{ data: job }, { data: w }, { data: m }] = await Promise.all([
    admin.from("jobs").select("channel, stage").eq("id", jobId).maybeSingle(),
    admin.from("partner_workers").select("full_legal_name, email, trade_role, profile_id").eq("id", workerId).maybeSingle(),
    admin.from("ceiling_measurements").select("status, external_source, external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
  ]);
  const { data: p } = w?.profile_id ? await admin.from("profiles").select("email, mitti_user_id, mitti_checked_email, mitti_checked_at").eq("id", w.profile_id).maybeSingle() : { data: null };
  const d = mittiAutoAssignDecision({
    channel: job?.channel ?? null, stage: job?.stage ?? null, tradeRole: w?.trade_role ?? null,
    measurementComplete: m?.status === "complete",
    hasProfile: !!p, access: p ? mittiAccessOf(p) : null, email: p?.email ?? w?.email ?? null,
  });
  if (d.action === "skip") return { status: "not_needed" };
  if (d.action === "flag") {
    await logEvent(jobId, actorId, "mitti_access_needed", `Needs Mitti access: ${d.reason}`, { worker_id: workerId }, { internal: true });
    return { status: "needs_mitti_access", message: d.reason };
  }
  try {
    const { createAssignMittiAudit, realMittiCall } = await import("./mitti.server");
    const r = await createAssignMittiAudit(jobId, actorId, call ?? realMittiCall, { readyCheck: true, assignee: { userId: w!.profile_id!, fullName: w!.full_legal_name, email: p!.email! } });
    return { status: "assigned", auditId: r.auditId, reused: r.reused };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Mitti error";
    await logEvent(jobId, actorId, "mitti_access_needed", `Mitti Ready Check form could not be created automatically: ${msg}`, { worker_id: workerId }, { internal: true });
    return { status: "failed", message: msg };
  }
}
