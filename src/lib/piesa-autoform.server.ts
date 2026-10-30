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
import { isUniqueViolation, stableUuid } from "./mitti-create-claim.core";
import { ASSESSMENT_ROUND_RESET, REPEAT_PIESA_FORM_RESET_EVENT, repeatFormResetSeed, repeatFormStep } from "./repeat-piesa-form.core";

export type PiesaAutoFormResult = { outcome: "created" | "reused" | "skipped" | "held" | "failed"; reason?: string; auditId?: string };

export async function onPiesaBooked(jobId: string, bookingId: string, actorId: string | null, opts: { call?: MittiCall } = {}): Promise<PiesaAutoFormResult> {
  // Jo 29 Oct 2026: a repeat PIESA (lapsed 30-day window) gets its own new form — first move the first check to history.
  try {
    await startRepeatRoundIfDue(jobId, actorId);
  } catch (e) {
    return failed(jobId, bookingId, actorId, `New PIESA round not started: ${e instanceof Error ? e.message : String(e)}`);
  }
  const [{ data: job, error: je }, { data: a, error: ae }, { data: asg, error: se }] = await Promise.all([
    admin.from("jobs").select("id, source, business_unit, deleted_at, qa_archived_at").eq("id", jobId).maybeSingle(),
    admin.from("assessments").select("external_mitti_id").eq("job_id", jobId).maybeSingle(),
    admin.from("job_assignments").select("user_id, business_id, businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle(),
  ]);
  if (je || ae || se) return failed(jobId, bookingId, actorId, "The job could not be read.");
  if (!job) return { outcome: "skipped", reason: "job not found" };
  const d = piesaAutoFormDecision({ deleted: !!job.deleted_at, archived: !!job.qa_archived_at, businessUnit: job.business_unit, hasPiesaForm: !!a?.external_mitti_id });
  if (d.action === "skip" && d.reason !== "PIESA form already created") return { outcome: "skipped", reason: d.reason };

  // Only a positively held real job receives the companion rectification form. Failed reads stop creation.
  const { readInHouseDispatchState } = await import("./in-house-suppression.server");
  const state = await readInHouseDispatchState([jobId]);
  if (state.failed) return failed(jobId, bookingId, actorId, "Couldn't check the job's partner — please try again.");
  const paired = job.source !== "qa_test" && state.held.has(jobId);
  if (d.action === "skip" && !paired) return { outcome: "skipped", reason: d.reason };

  const assignee = await piesaTestAssignee(job.source, asg as never);
  const { createAssignMittiAudit, realMittiCall } = await import("./mitti.server");
  const { MittiClaimHeld, MittiOutcomeUncertain } = await import("./mitti-create.server");
  try {
    const r = await createAssignMittiAudit(jobId, actorId, opts.call ?? realMittiCall, assignee ? { assignee } : {});
    if (paired) {
      const { createFixesForm } = await import("./fixes-day.server");
      const companion = await createFixesForm(jobId, actorId, bookingId, opts.call, { atPiesaBooking: true });
      if (companion.status === "held" || companion.reason && companion.status === "created") return failed(jobId, bookingId, actorId, companion.reason ?? "Rectification form creation is held");
    }
    return { outcome: r.reused ? "reused" : "created", auditId: r.auditId };
  } catch (e) {
    // Someone (the office button, a second booking confirmation) is creating it right now: theirs stands.
    if (e instanceof MittiClaimHeld) return { outcome: "held", reason: e.message };
    const reason = e instanceof MittiOutcomeUncertain ? "Mitti may have made the form but the reply was lost — check Mitti first" : e instanceof Error ? e.message : "Mitti error";
    return failed(jobId, bookingId, actorId, reason);
  }
}

/** Repeat PIESA booked (Jo 29 Oct 2026): ONCE per lapsed deadline, the first check moves to history (a stable-id
 *  `repeat_piesa_form_reset` event; its piesa_records row stays) and the job's one assessments row starts a new round, so
 *  the decision-398 path below makes a NEW form (the claim generation moves on with the event). Replays do nothing. */
async function startRepeatRoundIfDue(jobId: string, actorId: string | null): Promise<void> {
  const { repeatPiesaContext } = await import("./repeat-piesa.server");
  const { state } = await repeatPiesaContext(jobId);
  const deadline = state.stage === "offer" ? state.deadline : null;
  if (!deadline) return;
  const id = await stableUuid(repeatFormResetSeed(jobId, deadline));
  const readReset = async () => {
    const { data, error } = await admin.from("workflow_events").select("details").eq("id", id).eq("job_id", jobId).eq("event_type", REPEAT_PIESA_FORM_RESET_EVENT).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { previousAuditId: ((data.details ?? {}) as { previous_audit_id?: string | null }).previous_audit_id ?? null } : null;
  };
  const [reset, { data: row, error: ae }] = await Promise.all([
    readReset(),
    admin.from("assessments").select("status, external_mitti_id, piesa_outcome, assessed_on").eq("job_id", jobId).maybeSingle(),
  ]);
  if (ae) throw new Error(ae.message);
  const step = repeatFormStep({ repeatDeadline: deadline, reset, current: row ? { auditId: row.external_mitti_id, status: row.status } : null });
  if (step !== "reset") return;
  if (!reset) {
    const { error } = await admin.from("workflow_events").insert({
      id, job_id: jobId, actor_id: actorId, event_type: REPEAT_PIESA_FORM_RESET_EVENT,
      summary: "Repeat safety check (PIESA) booked — the first check is kept on record and a new Mitti form will be made",
      details: { deadline, previous_audit_id: row?.external_mitti_id ?? null, previous_outcome: row?.piesa_outcome ?? null, previous_assessed_on: row?.assessed_on ?? null } as never,
      internal: true,
    });
    if (error && !isUniqueViolation(error)) throw new Error(error.message);
  }
  // Always the STORED event's first form (a racing booking confirmation may have written it first).
  const stored = await readReset();
  if (!stored) throw new Error("the repeat PIESA record could not be read back");
  let q = admin.from("assessments").update(ASSESSMENT_ROUND_RESET as never).eq("job_id", jobId).eq("status", "complete");
  q = stored.previousAuditId == null ? q.is("external_mitti_id", null) : q.eq("external_mitti_id", stored.previousAuditId);
  const { error: ue } = await q;
  if (ue) throw new Error(ue.message);
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
