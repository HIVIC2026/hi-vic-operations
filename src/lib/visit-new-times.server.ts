// Decision 376 (approved by Jo, decision 384): the owner is told ONCE (email O74 + text) when the TRADE cancels a booked visit — called only from
// visit-events.server `tradeCancelVisit`, after `reopen` has recorded `visit_times_reopened` for that booking. The notice
// is recorded as a `visit_new_times_notice` workflow event BEFORE anything is sent (once per booking, ever). TEST jobs →
// test-send; real owners → the guarded owner email path (customer_comms_enabled + consent + opt-outs) and the one real
// SMS sender (customer_comms_enabled + the `visit_new_times` text switch still gate delivery). Best-effort: never throws to the cancel, never changes a stage.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  VISIT_NEW_TIMES_APPROVED, VISIT_NEW_TIMES_EVENT, VISIT_NEW_TIMES_PURPOSE, VISIT_NEW_TIMES_SMS_TYPE, isNewTimesVisit, renderVisitNewTimesEmail,
  visitNewTimesKeys, visitNewTimesLink, visitNewTimesText, type NewTimesVisit,
} from "./visit-new-times.core";
import type { VisitKind } from "./visit-events.core";

/** Whether My job lets the owner pick new times right now (the same owner states the screens read). Fail closed: false. */
async function ownerPicksNow(jobId: string, kind: NewTimesVisit): Promise<boolean> {
  try {
    if (kind === "ready_check") return (await (await import("./readycheck-booking.server")).ownerReadyCheckWindowState(jobId)).canPick;
    if (kind === "assessment") return (await (await import("./allocation.server")).ownerPiesaWindowState(jobId)).canPick;
    return false; // install days: the same installer offers new days (install-days.core)
  } catch { return false; }
}

export async function notifyOwnerVisitNewTimes(i: { jobId: string; bookingId: string; kind: VisitKind; wasIso: string }): Promise<string> {
  try {
    if (!isNewTimesVisit(i.kind)) return "skipped — the office arranges this visit";
    const kind = i.kind;
    const [{ data: reopened }, { data: prior }] = await Promise.all([
      admin.from("workflow_events").select("id, created_at").eq("job_id", i.jobId).eq("event_type", "visit_times_reopened").contains("details", { booking_id: i.bookingId }).limit(1).maybeSingle(),
      admin.from("workflow_events").select("id").eq("job_id", i.jobId).eq("event_type", VISIT_NEW_TIMES_EVENT).contains("details", { booking_id: i.bookingId }).limit(1).maybeSingle(),
    ]);
    if (!reopened) return "skipped — times not reopened";
    if (prior) return "already handled";
    const { data: job } = await admin.from("jobs").select("owner_id, source, deleted_at").eq("id", i.jobId).maybeSingle();
    if (!job || job.deleted_at) return "skipped";
    const ownerPicks = await ownerPicksNow(i.jobId, kind);
    await logEvent(i.jobId, null, VISIT_NEW_TIMES_EVENT, `Owner told the trade cancelled the booked visit — ${ownerPicks ? "choose new times" : "new times on the way"} (email O74 + text prepared)`, { booking_id: i.bookingId, kind, owner_picks: ownerPicks, was: i.wasIso }, { internal: true });
    const [{ data: owner }, { data: asg }, myJob] = await Promise.all([
      admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle(),
      admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", i.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
      (await import("./veec-copy-email.server")).ownerMyJobLink(i.jobId),
    ]);
    if (!myJob) {
      await logEvent(i.jobId, null, "visit_new_times_not_sent", "No working owner job link, so the owner could not be told the visit was cancelled", { booking_id: i.bookingId, kind }, { internal: true });
      return "not sent — owner link missing";
    }
    const link = visitNewTimesLink(myJob, kind);
    const facts = { kind, wasIso: i.wasIso, ownerPicks, link };
    const { firstName } = await import("./worker-links.core");
    const build = (unsubscribeUrl: string | null, test: boolean) => renderVisitNewTimesEmail({ ...facts, firstName: firstName(owner?.full_name ?? null), unsubscribeUrl, test });
    const smsBody = visitNewTimesText(facts);
    const keys = visitNewTimesKeys(i.jobId, i.bookingId);
    const out: string[] = [];
    if (job.source === "qa_test") {
      const { isTestPartner } = await import("./test-send.core");
      const { sendTestEmail, sendTestSms } = await import("./test-send.server");
      const ctx = { jobId: i.jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `visit_new_times:${i.bookingId}`, actorId: null };
      const mail = build(null, true);
      const e = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
      const s = await sendTestSms(ctx, owner?.phone ?? "", smsBody);
      return [`email ${e.status}: ${e.detail}`, `sms ${s.status}: ${s.detail}`].join("; ");
    }
    if (!VISIT_NEW_TIMES_APPROVED) out.push("email not sent — wording awaiting approval");
    else if (!owner?.email) out.push("email not sent — no owner email");
    else {
      try {
        await (await import("./comms.server")).assertCustomerDeliveryAllowed(i.jobId, "Visit cancelled – new times email");
        out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId: i.jobId, jobSource: job.source, to: owner.email, purpose: VISIT_NEW_TIMES_PURPOSE, key: keys.email, build: (u) => build(u, false) })}`);
      } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
    }
    // The one real text sender: switch, approval (held while the type is unapproved), quiet hours, consent and STOP live there.
    const { currentBooking } = await import("./visit-events.server");
    const rebooked = !!(await currentBooking(i.jobId, kind).catch(() => null));
    const s = await (await import("./sms.server")).sendRealSms({ type: VISIT_NEW_TIMES_SMS_TYPE, idempotencyKey: keys.sms, to: owner?.phone ?? null, body: smsBody, jobId: i.jobId, event: { at: reopened.created_at, current: !rebooked } });
    out.push(`sms ${s.status}: ${s.detail}`);
    return out.join("; ");
  } catch (e) {
    console.error("visit new times notice skipped", i.jobId, (e as Error).message);
    return `not sent — ${(e as Error).message}`;
  }
}
