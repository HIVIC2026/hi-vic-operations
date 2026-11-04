// Part 4 Task 8 (Jo 2 Nov 2026, answer 4): email the owner straight away when a trade drops a booked visit. Called by Part 5's
// "Can't do this one" (tradeHandBack) and Part 6's electricianCantDo once they have cancelled a confirmed booking — NOT by
// "Owner cancelled" (the owner already knows). Email only, no text. Not a compliance send: Do not contact stops it.
// Records ONE `visit_cancelled_owner_notice` per booking before sending; the email key (per booking) stops a repeat.
// New-flow message: deliberately NOT held by inHouseDispatchSkip (that hold is for old-flow messages on in-house jobs).
// TEST jobs → test-send only. Real owners → `sendGuardedOwnerEmail` behind VISIT_CANCELLED_OWNER_APPROVED + customer_comms_enabled.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { VISIT_CANCELLED_EVENT, VISIT_CANCELLED_OWNER_APPROVED, VISIT_CANCELLED_PURPOSE, visitCancelledKey, visitCancelledOwnerEmail } from "./visit-cancelled-owner.core";

export type VisitCancelledDeps = { approved: boolean };
const defaultDeps = (): VisitCancelledDeps => ({ approved: VISIT_CANCELLED_OWNER_APPROVED });

export async function queueVisitCancelledOwnerEmail(jobId: string, bookingId: string, by: "installer" | "electrician", deps: VisitCancelledDeps = defaultDeps()): Promise<string> {
  const { data: job } = await admin.from("jobs").select("id, owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "not sent — job not found";
  const test = job.source === "qa_test";
  if (!test && !deps.approved) return "awaiting approval";
  const [{ data: bk }, { data: owner }] = await Promise.all([
    admin.from("bookings").select("id, scheduled_start").eq("id", bookingId).eq("job_id", jobId).maybeSingle(),
    job.owner_id ? admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (!bk?.scheduled_start) return "not sent — booking not found";
  if (!owner?.email) return "not sent — no owner email";
  const { firstName } = await import("./worker-links.core");
  const facts = { firstName: firstName(owner.full_name ?? null), startIso: bk.scheduled_start };
  const key = visitCancelledKey(bookingId);
  const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", VISIT_CANCELLED_EVENT).contains("details", { booking_id: bookingId }).limit(1).maybeSingle();
  if (!prior) {
    const { logEvent } = await import("./workflow.server");
    await logEvent(jobId, null, VISIT_CANCELLED_EVENT, "Owner told their booked visit can't go ahead: email prepared", { booking_id: bookingId, dropped_by: by, key }, { internal: true });
  }
  if (test) {
    const { sendTestEmail } = await import("./test-send.server");
    const mail = visitCancelledOwnerEmail(facts);
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: false, label: `${VISIT_CANCELLED_PURPOSE}:${bookingId}`, actorId: null }, owner.email, mail.subject, mail.html, mail.text);
    return `email ${r.status}: ${r.detail}`;
  }
  try {
    await (await import("./comms.server")).assertCustomerDeliveryAllowed(jobId, "Visit can't go ahead email");
    return await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId, jobSource: job.source, to: owner.email, purpose: VISIT_CANCELLED_PURPOSE, key, build: () => visitCancelledOwnerEmail(facts) });
  } catch (e) { return `not sent — ${(e as Error).message}`; }
}
