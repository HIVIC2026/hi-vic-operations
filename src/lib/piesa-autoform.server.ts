// Decision 398 (Jo 26 Oct 2026): when the owner's PIESA time is booked, the electrician's A3 PIESA Mitti form is made
// automatically through the SAME path as the office "Create Mitti form" button (mitti.server createAssignMittiAudit: its
// guards, its atomic per-job claim and its reuse of an existing form), so it is never created twice. Unlike the button
// it never overrides an earlier attempt with an unknown result. TEST jobs (qa_test, or a TEST partner electrician) follow
// the existing test rule: the form is assigned to the TEST Mitti account only. Any failure = ONE Needs me row for this
// booking (internal event, needs_office); the office button stays as the backup. Never sends, never moves a stage, never
// fails the booking.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import type { MittiCall } from "./mitti.core";
import { PIESA_AUTOFORM_FAILED_EVENT, piesaAutoFormDecision } from "./piesa-autoform.core";

export type PiesaAutoFormResult = { outcome: "created" | "reused" | "skipped" | "held" | "failed"; reason?: string; auditId?: string };

export async function onPiesaBooked(jobId: string, bookingId: string, actorId: string | null, opts: { call?: MittiCall } = {}): Promise<PiesaAutoFormResult> {
  const [{ data: job, error: je }, { data: a, error: ae }, { data: asg, error: se }] = await Promise.all([
    admin.from("jobs").select("id, source, business_unit, deleted_at, qa_archived_at").eq("id", jobId).maybeSingle(),
    admin.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle(),
    admin.from("job_assignments").select("user_id, business_id, businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle(),
  ]);
  if (je || ae || se) return failed(jobId, bookingId, actorId, "The job could not be read.");
  if (!job) return { outcome: "skipped", reason: "job not found" };
  const d = piesaAutoFormDecision({ deleted: !!job.deleted_at, archived: !!job.qa_archived_at, businessUnit: job.business_unit, hasPiesaForm: !!a?.external_mitti_id });
  if (d.action === "skip") return { outcome: "skipped", reason: d.reason };

  const assignee = await piesaTestAssignee(job.source, asg as never);
  const { createAssignMittiAudit, realMittiCall } = await import("./mitti.server");
  const { MittiClaimHeld, MittiOutcomeUncertain } = await import("./mitti-create.server");
  try {
    const r = await createAssignMittiAudit(jobId, actorId, opts.call ?? realMittiCall, assignee ? { assignee } : {});
    return { outcome: r.reused ? "reused" : "created", auditId: r.auditId };
  } catch (e) {
    // Someone (the office button, a second booking confirmation) is creating it right now: theirs stands.
    if (e instanceof MittiClaimHeld) return { outcome: "held", reason: e.message };
    const reason = e instanceof MittiOutcomeUncertain ? "Mitti may have made the form but the reply was lost — check Mitti first" : e instanceof Error ? e.message : "Mitti error";
    return failed(jobId, bookingId, actorId, reason);
  }
}

/** Practice jobs (qa_test or a TEST partner's electrician) only ever reach the TEST Mitti account (as the Ready Check
 *  sweep). Shared with the retry sweep (mitti-retry.server.ts), so a retry is assigned exactly like the first attempt. */
export async function piesaTestAssignee(source: string | null, asg: { user_id: string; businesses?: { onboarding_notes?: string | null } | null } | null): Promise<{ userId: string; fullName: string | null; email: string } | undefined> {
  const { isTestPartner } = await import("./test-send.core");
  if (!asg || !(source === "qa_test" || isTestPartner((asg.businesses ?? null) as never))) return undefined;
  const { TEST_MITTI_ASSIGNEE } = await import("./onsite-ready-check.core");
  return { userId: asg.user_id, fullName: null, email: TEST_MITTI_ASSIGNEE };
}

/** ONE office item per booking (a repeat confirmation of the same booking never adds a second). */
async function failed(jobId: string, bookingId: string, actorId: string | null, reason: string): Promise<PiesaAutoFormResult> {
  const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", PIESA_AUTOFORM_FAILED_EVENT).contains("details", { booking_id: bookingId });
  if (!count) {
    await logEvent(jobId, actorId, PIESA_AUTOFORM_FAILED_EVENT, `Safety check (A3 PIESA) Mitti form could not be created automatically: ${reason}`.slice(0, 500),
      { booking_id: bookingId, reason: reason.slice(0, 300), needs_office: true, decision: 398 }, { internal: true });
  }
  return { outcome: "failed", reason };
}
