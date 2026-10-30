import { inHouseDispatchSkip } from "./in-house-suppression.server";
// Decision 170 (Jo, 24 Oct 2026): owner notice when an unpaid provisional install day is released after 48h
// (payments.server sweepProvisionalBookings). Records ONE `install_booking_released_owner_notice` event per released
// booking before sending, so a retried tick never texts or emails twice. TEST jobs → test-send only; real owners → the
// guarded owner-email path (customer_comms_enabled, consent, opt-outs, unique idempotency key) and the one real SMS
// sender (type `deposit_release`, same switches). Wording + keys in deposit-release-notice.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  DEPOSIT_RELEASE_NOTICE_EVENT, DEPOSIT_RELEASE_SMS_TYPE, PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED, depositReleaseKeys, depositReleaseText, renderDepositReleasedEmail,
} from "./deposit-release-notice.core";
import type { BankDetails } from "./payments.core";

export type DepositReleaseNoticeInput = {
  jobId: string; bookingId: string;
  /** The released install start (ISO). */
  wasStart: string;
  depositCents: number; bank: BankDetails; reference: string | null;
  /** When the booking was released (defaults to now); the text's decision 165 freshness event. */
  releasedAt?: string;
};

export async function sendDepositReleaseNotice(p: DepositReleaseNoticeInput): Promise<string> {
  const skipped = await inHouseDispatchSkip(p.jobId);
  if (skipped) return skipped;
  const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", p.jobId).eq("event_type", DEPOSIT_RELEASE_NOTICE_EVENT).contains("details", { booking_id: p.bookingId }).limit(1).maybeSingle();
  if (prior) return "already handled";
  await logEvent(p.jobId, null, DEPOSIT_RELEASE_NOTICE_EVENT, "Owner told the install day was released (deposit not received within 48 hours): text + email prepared", { booking_id: p.bookingId, was: p.wasStart }, { internal: true });
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", p.jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: asg }, link] = await Promise.all([
    admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(onboarding_notes)").eq("job_id", p.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(p.jobId),
  ]);
  if (!link) {
    await logEvent(p.jobId, null, "install_booking_released_owner_notice_not_sent", "No working owner job link, so the released-day notice could not be sent", { booking_id: p.bookingId }, { internal: true });
    return "not sent — owner link missing";
  }
  const { firstName } = await import("./worker-links.core");
  const { formatInstallDay } = await import("./install-days.core");
  const { bankDetailLines } = await import("./payments.core");
  const facts = {
    firstName: firstName(owner?.full_name ?? null), day: formatInstallDay(p.wasStart, false), link,
    depositAmount: p.depositCents > 0 ? `$${(p.depositCents / 100).toFixed(2)}` : null, bankLines: bankDetailLines(p.bank, p.reference),
  };
  const keys = depositReleaseKeys(p.bookingId);
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const ctx = { jobId: p.jobId, jobSource: job.source, partnerIsTest: isTestPartner((asg?.businesses ?? null) as { onboarding_notes?: string | null } | null), label: `deposit_release:${p.bookingId}`, actorId: null };
    const mail = renderDepositReleasedEmail({ ...facts, test: true });
    const e = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    const s = await sendTestSms(ctx, owner?.phone ?? "", depositReleaseText(facts));
    return `email ${e.status}: ${e.detail}; sms ${s.status}: ${s.detail}`;
  }
  const out: string[] = [];
  if (!PROVISIONAL_RELEASE_OWNER_NOTICE_APPROVED) out.push("email not sent — wording awaiting approval");
  else if (!owner?.email) out.push("email not sent — no owner email");
  else {
    try {
      await (await import("./comms.server")).assertCustomerDeliveryAllowed(p.jobId, "Install day released email");
      out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId: p.jobId, jobSource: job.source, to: owner.email, purpose: "deposit_release", key: keys.email, build: () => renderDepositReleasedEmail({ ...facts, test: false }) })}`);
    } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
  }
  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({ type: DEPOSIT_RELEASE_SMS_TYPE, idempotencyKey: keys.sms, to: owner?.phone ?? null, body: depositReleaseText(facts), jobId: p.jobId, event: { at: p.releasedAt ?? new Date().toISOString() } });
  out.push(`sms ${s.status}: ${s.detail}`);
  return out.join("; ");
}
