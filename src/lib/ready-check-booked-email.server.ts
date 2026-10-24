// Decision 80 (Jo 24 Oct 2026): "You're booked" to the owner after an our-lead Ready Check is booked or changed.
// Best-effort: never blocks the booking. TEST jobs get the draft email through test-send; real owners only once Jo
// approves the wording AND customer messages are on, through the one guarded owner-email path. The text is never sent
// (no approved wording/SMS type). One email per booked start time.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export async function emailOwnerReadyCheckBooked(jobId: string, startIso: string): Promise<string> {
  const { data: job } = await admin.from("jobs").select("owner_id, source, channel").eq("id", jobId).maybeSingle();
  if (!job || job.channel !== "hivic_sourced") return "skipped";
  const [{ data: owner }, { data: asg }, { data: link }, { count: before }] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(name, trading_name, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "cancelled"),
  ]);
  const changed = (before ?? 0) > 0;
  const { linkUsable } = await import("./estimatelink.core");
  if (!link || !linkUsable(link)) {
    await logEvent(jobId, null, "ready_check_booked_email_not_sent", "Ready Check booked — no working owner job link, so no booked email or text was sent", { starts_at: startIso, changed }, { internal: true });
    return "not sent — owner link missing";
  }
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; onboarding_notes: string | null } | null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { firstName } = await import("./worker-links.core");
  const { formatReadyCheckTime } = await import("./ready-check-times.core");
  const { renderReadyCheckBookedEmail, READY_CHECK_BOOKED_EMAIL_APPROVED } = await import("./ready-check-booked-email.core");
  const input = {
    firstName: firstName(owner?.full_name ?? null), when: formatReadyCheckTime(startIso), changed,
    installerName: (biz?.trading_name ?? biz?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null, myJobUrl: `${CUSTOMER_BASE}/my-job/${link.token}`,
  };
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const mail = renderReadyCheckBookedEmail({ ...input, test: true });
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `ready_check_booked:${startIso}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text);
    return `${r.status}: ${r.detail}`;
  }
  if (!READY_CHECK_BOOKED_EMAIL_APPROVED) {
    await logEvent(jobId, null, "ready_check_booked_email_not_sent", `Ready Check ${changed ? "time changed" : "booked"} — the "You're booked" email and text wording is awaiting approval, so nothing was sent`, { starts_at: startIso, changed }, { internal: true });
    return "not sent — wording awaiting approval";
  }
  if (!owner?.email) return "not sent — no owner email";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  try { await assertCustomerDeliveryAllowed(jobId, "Ready Check booked email"); } catch (e) { return `not sent — ${(e as Error).message}`; }
  return (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
    jobId, jobSource: job.source, to: owner.email, purpose: "ready_check_booked", key: `ready-check-booked:v1:${jobId}:${startIso}`,
    build: () => renderReadyCheckBookedEmail({ ...input, test: false }),
  });
}
