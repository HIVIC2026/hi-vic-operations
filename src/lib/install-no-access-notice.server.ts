// Decision 215 (Jo, 24 Oct 2026): owner notice after an install-day "Couldn't get in?" (trade-view.server
// tradeCouldntGetIn → install-days.server changeInstallDay). Records ONE `install_no_access_owner_notice` event per
// cancelled install booking before sending, so a retry never texts or emails twice. TEST jobs → test-send only; real
// owners → the guarded owner-email path and the one real SMS sender (type `install_no_access`), both behind
// customer_comms_enabled and, until Jo approves the wording, held by INSTALL_NO_ACCESS_NOTICE_APPROVED / wordingApproved.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { INSTALL_NO_ACCESS_NOTICE_APPROVED, INSTALL_NO_ACCESS_NOTICE_EVENT, INSTALL_NO_ACCESS_SMS_TYPE, installNoAccessKeys, installNoAccessText, renderInstallNoAccessEmail } from "./install-no-access-notice.core";

export type InstallNoAccessNoticeInput = {
  jobId: string; bookingId: string;
  /** The cancelled install start (ISO) and the installer's reason. */
  wasStart: string; reason: string;
  /** The installer's new days when offered in the same action (ISO starts); [] = they follow by the normal O33 email. */
  newDayStarts?: string[];
  reportedAt?: string;
};

export async function sendInstallNoAccessNotice(p: InstallNoAccessNoticeInput): Promise<string> {
  const { data: prior } = await admin.from("workflow_events").select("id").eq("job_id", p.jobId).eq("event_type", INSTALL_NO_ACCESS_NOTICE_EVENT).contains("details", { booking_id: p.bookingId }).limit(1).maybeSingle();
  if (prior) return "already handled";
  await logEvent(p.jobId, null, INSTALL_NO_ACCESS_NOTICE_EVENT, "Owner told we couldn't get in on the install day: text + email prepared", { booking_id: p.bookingId, was: p.wasStart, reason: p.reason }, { internal: true });
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", p.jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: asg }, link, ctx] = await Promise.all([
    admin.from("owners").select("full_name, email, phone").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(name, trading_name, onboarding_notes)").eq("job_id", p.jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    (await import("./veec-copy-email.server")).ownerMyJobLink(p.jobId),
    (await import("./install-days.server")).installDayContext(p.jobId),
  ]);
  if (!link) {
    await logEvent(p.jobId, null, "install_no_access_owner_notice_not_sent", "No working owner job link, so the couldn't-get-in notice could not be sent", { booking_id: p.bookingId }, { internal: true });
    return "not sent — owner link missing";
  }
  const { firstName } = await import("./worker-links.core");
  const { formatInstallDay } = await import("./install-days.core");
  const { splitDayTime } = await import("./ready-check-times-email.core");
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; onboarding_notes: string | null } | null;
  const installBy = ctx.deadline ? new Intl.DateTimeFormat("en-AU", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${ctx.deadline}T12:00:00Z`)) : null;
  const facts = {
    firstName: firstName(owner?.full_name ?? null), installerName: (biz?.trading_name ?? biz?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null,
    day: formatInstallDay(p.wasStart, false), newDays: (p.newDayStarts ?? []).map((s) => ({ ...splitDayTime(formatInstallDay(s)), href: link })), installBy, link,
  };
  const keys = installNoAccessKeys(p.bookingId);
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const tctx = { jobId: p.jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `install_no_access:${p.bookingId}`, actorId: null };
    const mail = renderInstallNoAccessEmail({ ...facts, test: true });
    const e = await sendTestEmail(tctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    const s = await sendTestSms(tctx, owner?.phone ?? "", installNoAccessText(facts));
    return `email ${e.status}: ${e.detail}; sms ${s.status}: ${s.detail}`;
  }
  const out: string[] = [];
  if (!INSTALL_NO_ACCESS_NOTICE_APPROVED) out.push("email not sent — wording awaiting approval");
  else if (!owner?.email) out.push("email not sent — no owner email");
  else {
    try {
      await (await import("./comms.server")).assertCustomerDeliveryAllowed(p.jobId, "Couldn't get in email");
      out.push(`email ${await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({ jobId: p.jobId, jobSource: job.source, to: owner.email, purpose: "install_no_access", key: keys.email, build: () => renderInstallNoAccessEmail({ ...facts, test: false }) })}`);
    } catch (e) { out.push(`email not sent — ${(e as Error).message}`); }
  }
  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({ type: INSTALL_NO_ACCESS_SMS_TYPE, idempotencyKey: keys.sms, to: owner?.phone ?? null, body: installNoAccessText(facts), jobId: p.jobId, event: { at: p.reportedAt ?? new Date().toISOString() } });
  out.push(`sms ${s.status}: ${s.detail}`);
  return out.join("; ");
}
