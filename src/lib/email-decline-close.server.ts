// Jo 27 Oct 2026: a matched owner's clear "not going ahead" email closes an unbooked, unpaid enquiry by itself through
// the office Cancel path (cancelJobFully, decision 227) — no owner or installer notice, no reply email. One history line
// (`email_decline_closed`) per job + message. Anything not eligible returns closed:false and the caller keeps the
// decision-245 Apply card. Never throws.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { MailMessage } from "./outlook-correspondence.core";
import { DECLINE_CLOSED_EVENT, DECLINE_CLOSED_LINE, declineAutoClose, isClearDecline } from "./email-intent.core";

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export async function closeOnDeclineEmail(p: { jobIds: string[]; message: MailMessage; fromPartner: boolean }): Promise<{ closed: boolean; why: string }> {
  const m = p.message;
  try {
    if (m.direction !== "inbound") return { closed: false, why: "not inbound" };
    const d = isClearDecline({ subject: m.subject, body: m.body, direction: m.direction, from: m.from, fromPartner: p.fromPartner });
    if (!d.decline) return { closed: false, why: "not a clear decline" };
    if (p.jobIds.length !== 1) return { closed: false, why: "the email matches more than one job" };
    const jobId = p.jobIds[0]!;
    const { data: job, error } = await admin.from("jobs").select("stage, owner_id, deleted_at").eq("id", jobId).maybeSingle();
    if (error || !job) return { closed: false, why: "job not found" };
    const [{ data: owner }, { data: bk }, { data: inv }] = await Promise.all([
      job.owner_id ? admin.from("owners").select("email").eq("id", job.owner_id).maybeSingle() : Promise.resolve({ data: null as { email: string | null } | null }),
      admin.from("bookings").select("id").eq("job_id", jobId).eq("status", "confirmed").limit(1),
      admin.from("invoices").select("id").eq("job_id", jobId).gt("total_paid", 0).limit(1),
    ]);
    const gate = declineAutoClose({
      stage: job.stage, deleted: !!job.deleted_at, senderIsOwner: !!owner?.email && lower(owner.email) === lower(m.from), fromPartner: p.fromPartner,
      matchedJobs: 1, confirmedBooking: (bk ?? []).length > 0, paid: (inv ?? []).length > 0,
    });
    if (!gate.close) return { closed: false, why: gate.why };
    const { cancelJobFully } = await import("./office-actions.server");
    await cancelJobFully(jobId, `${DECLINE_CLOSED_LINE} — “${d.phrase}”`.slice(0, 480), null, { note: `owner email ${m.providerMessageId.slice(-12)}`, tell: { owner: false, installer: false } });
    const { logEvent } = await import("./workflow.server");
    await logEvent(jobId, null, DECLINE_CLOSED_EVENT, `${DECLINE_CLOSED_LINE}: “${d.phrase}”`, { message_id: m.providerMessageId, phrase: d.phrase, from: m.from, reply_sent: false }, { internal: true });
    return { closed: true, why: "closed" };
  } catch (e) {
    console.error("decline auto-close skipped", e instanceof Error ? e.message : e);
    return { closed: false, why: e instanceof Error ? e.message : "error" };
  }
}

/** Was this message already auto-closed (so no reply or AI draft follows)? */
export async function declineClosedFor(jobId: string, messageId: string): Promise<boolean> {
  const { data } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", DECLINE_CLOSED_EVENT).contains("details", { message_id: messageId }).limit(1);
  return (data ?? []).length > 0;
}
