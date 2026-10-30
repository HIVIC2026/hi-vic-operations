import { inHouseDispatchSkip } from "./in-house-suppression.server";
// Decision 80 (Jo 24 Oct 2026): "You're booked" to the owner after an our-lead Ready Check is booked or changed.
// Best-effort: never blocks the booking. TEST jobs get the email through test-send; real owners only with the flag on
// (decision 81) AND customer messages on, through the one guarded owner-email path. No text is sent from here. One email
// per booked start time.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

/** Jo 29 Oct 2026 (HV-3542): every not-sent outcome, including a thrown error, is recorded for the office (no silent skips). */
export async function emailOwnerReadyCheckBooked(jobId: string, startIso: string): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  let outcome: string;
  try { outcome = await attemptBookedEmail(jobId, startIso); } catch (e) { outcome = `error — ${(e as Error).message}`; }
  await recordBookedNotSent(jobId, startIso, "email", outcome);
  return outcome;
}

/** Shared with the owner text: one internal event per not-sent reason and start time (repeat sweeps don't add rows). */
export async function recordBookedNotSent(jobId: string, startIso: string, channel: "email" | "text", outcome: string) {
  const { bookedNoticeNotSentReason, bookedNoticeSummary, BOOKED_NOT_SENT_EVENT } = await import("./ready-check-booked-notice.core");
  const reason = bookedNoticeNotSentReason(outcome);
  if (!reason) return;
  try {
    const { count } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", BOOKED_NOT_SENT_EVENT).contains("details", { channel, starts_at: startIso, reason });
    if ((count ?? 0) > 0) return;
    await logEvent(jobId, null, BOOKED_NOT_SENT_EVENT, bookedNoticeSummary(channel, reason), { channel, starts_at: startIso, reason }, { internal: true });
  } catch (e) { console.error("ready check booked not-sent note failed", (e as Error).message); }
}

async function attemptBookedEmail(jobId: string, startIso: string): Promise<string> {
  const { data: job } = await admin.from("jobs").select("owner_id, source, channel").eq("id", jobId).maybeSingle();
  if (!job) return "not sent — job not found";
  if (job.channel !== "hivic_sourced") return "not sent — not an our-lead job";
  const [{ data: owner }, { data: asg }, { data: link }, { count: before }, { data: prop }, { data: saved }] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    admin.from("job_assignments").select("businesses(name, trading_name, phone, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
    admin.from("bookings").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("kind", "ready_check").eq("status", "cancelled"),
    admin.from("jobs").select("properties(address_line, suburb)").eq("id", jobId).maybeSingle(),
    admin.from("lead_campaign_responses").select("saved_veu_discount, saved_total, saved_area_m2").eq("job_id", jobId).maybeSingle(),
  ]);
  const estimate = saved?.saved_total && Number(saved.saved_total) > 0 ? { rebate: Number(saved.saved_veu_discount ?? 0), price: Number(saved.saved_total), areaM2: Number(saved.saved_area_m2 ?? 0) } : null;
  const p = (prop?.properties ?? null) as { address_line: string | null; suburb: string | null } | null;
  const changed = (before ?? 0) > 0;
  const { linkUsable } = await import("./estimatelink.core");
  if (!link || !linkUsable(link)) {
    return "not sent — owner link missing";
  }
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; phone: string | null; onboarding_notes: string | null } | null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { firstName } = await import("./worker-links.core");
  const { formatReadyCheckTime } = await import("./ready-check-times.core");
  const { renderReadyCheckBookedEmail, READY_CHECK_BOOKED_EMAIL_APPROVED } = await import("./ready-check-booked-email.core");
  const input = {
    firstName: firstName(owner?.full_name ?? null), when: formatReadyCheckTime(startIso), changed,
    installerName: (biz?.trading_name ?? biz?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null, installerPhone: biz?.phone ?? null,
    address: [p?.address_line, p?.suburb].filter(Boolean).join(", ") || null, estimate, myJobUrl: `${CUSTOMER_BASE}/my-job/${link.token}`,
  };
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const mail = renderReadyCheckBookedEmail({ ...input, test: true });
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `ready_check_booked:${startIso}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text);
    return `${r.status}: ${r.detail}`;
  }
  if (!READY_CHECK_BOOKED_EMAIL_APPROVED) {
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
