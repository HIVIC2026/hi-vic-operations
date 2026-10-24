// Owner "choose a time for your Ready Check" email (Jo 24 Oct 2026). Best-effort: never blocks the installer's offer.
// TEST jobs get the draft through test-send; real owners only once Jo approves the wording AND customer messages are
// on, through the one guarded owner-email path. One email per set of offered times.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export async function emailOwnerReadyCheckTimes(jobId: string, startsAt: string[]): Promise<string> {
  const { data: job } = await admin.from("jobs").select("owner_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: asg }, { data: link }] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(name, trading_name, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
  ]);
  const { linkUsable } = await import("./estimatelink.core");
  const key = [...startsAt].sort().join(",");
  if (!link || !linkUsable(link)) {
    await logEvent(jobId, null, "ready_check_times_email_not_sent", "Ready Check times offered — no working owner job link, so no email was sent", { starts_at: startsAt }, { internal: true });
    return "not sent — owner link missing";
  }
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; onboarding_notes: string | null } | null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { firstName } = await import("./worker-links.core");
  const { formatReadyCheckTime } = await import("./ready-check-times.core");
  const { renderReadyCheckTimesEmail, READY_CHECK_TIMES_EMAIL_APPROVED } = await import("./ready-check-times-email.core");
  const input = {
    firstName: firstName(owner?.full_name ?? null), times: [...startsAt].sort().map((s) => formatReadyCheckTime(s)),
    installerName: (biz?.trading_name ?? biz?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null, myJobUrl: `${CUSTOMER_BASE}/my-job/${link.token}`,
  };
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const mail = renderReadyCheckTimesEmail({ ...input, test: true });
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `ready_check_times:${key}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text);
    return `${r.status}: ${r.detail}`;
  }
  if (!READY_CHECK_TIMES_EMAIL_APPROVED) {
    await logEvent(jobId, null, "ready_check_times_email_not_sent", "Ready Check times offered — the email wording is awaiting approval, so no email was sent", { starts_at: startsAt }, { internal: true });
    return "not sent — wording awaiting approval";
  }
  if (!owner?.email) return "not sent — no owner email";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  try { await assertCustomerDeliveryAllowed(jobId, "Ready Check times email"); } catch (e) { return `not sent — ${(e as Error).message}`; }
  return (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
    jobId, jobSource: job.source, to: owner.email, purpose: "ready_check_times", key: `ready-check-times:v1:${jobId}:${key}`,
    build: () => renderReadyCheckTimesEmail({ ...input, test: false }),
  });
}
