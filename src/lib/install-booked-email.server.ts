import { inHouseDispatchSkip } from "./in-house-suppression.server";
// Jo 24 Oct 2026: "Your install is booked" to the owner once a day and time are agreed. Best-effort: never blocks the
// booking. TEST jobs get the draft through test-send; real owners only once Jo approves the wording AND customer
// messages are on, through the one guarded owner-email path. One email per booked start time.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export async function emailOwnerInstallBooked(jobId: string, startIso: string, opts: { depositReceived?: boolean } = {}): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  const { data: job } = await admin.from("jobs").select("owner_id, property_id, source").eq("id", jobId).maybeSingle();
  if (!job) return "skipped";
  const [{ data: owner }, { data: prop }, { data: asg }, { data: m }, { data: link }] = await Promise.all([
    admin.from("owners").select("full_name, email").eq("id", job.owner_id).maybeSingle(),
    job.property_id ? admin.from("properties").select("address_line, suburb, postcode").eq("id", job.property_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from("job_assignments").select("business_id, businesses(name, trading_name, phone, onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle(),
    admin.from("ceiling_measurements").select("removal_required").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("customer_estimate_links").select("token, status, expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
  ]);
  const { linkUsable } = await import("./estimatelink.core");
  if (!link || !linkUsable(link)) {
    await logEvent(jobId, null, "install_booked_email_not_sent", "Install booked — no working owner job link, so no booked email was sent", { starts_at: startIso }, { internal: true });
    return "not sent — owner link missing";
  }
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; phone: string | null; onboarding_notes: string | null } | null;
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { fullAddress } = await import("./address");
  const { firstName } = await import("./worker-links.core");
  const { formatInstallDay } = await import("./install-days.core");
  const { renderInstallBookedEmail, INSTALL_BOOKED_EMAIL_APPROVED } = await import("./install-booked-email.core");
  // Decision 139: the 10% install deposit (card, bank transfer or PayID, 48h hold) when it is still owing under the payment rule.
  const pay = await (await import("./payments.server")).jobPaymentView(jobId).catch(() => null);
  const depositStep = pay?.steps.find((s) => s.key === "install_deposit");
  // Jo 26 Oct 2026: never "Your install is booked" while the 10% deposit is unpaid.
  if (pay && depositStep && depositStep.amountCents > 0 && !["paid", "waived"].includes(depositStep.state)) {
    await logEvent(jobId, null, "install_booked_email_not_sent", "Install booked email not sent — the 10% install deposit is not paid", { starts_at: startIso }, { internal: true });
    return "not sent — deposit not paid";
  }
  const deposit = pay && depositStep && (depositStep.state === "requested" || depositStep.state === "overdue") && pay.provisional.decision === "provisional"
    ? { amount: `$${(depositStep.outstandingCents / 100).toFixed(2)}`, holdUntil: pay.provisional.expiresAt ? formatInstallDay(pay.provisional.expiresAt) : null, bankLines: (await import("./payments.core")).bankDetailLines(pay.bank, pay.reference) }
    : null;
  // Decision 151: once the deposit has cleared, the same email says "Deposit received ✓" with the balance due on the day.
  const paidDeposit = opts.depositReceived && pay && depositStep ? { depositPaid: depositStep.amountCents / 100, balanceDue: Math.max(0, (pay.plan.thresholds.balance - pay.paid.install) / 100) } : null; // batch 3b: the install invoice's balance
  const input = {
    firstName: firstName(owner?.full_name ?? null), when: formatInstallDay(startIso), deposit: opts.depositReceived ? null : deposit, payment: paidDeposit,
    address: prop ? fullAddress(prop.address_line, prop.suburb, prop.postcode) || null : null,
    installerName: biz?.trading_name ?? biz?.name ?? null, installerPhone: biz?.phone ?? null,
    removal: m?.removal_required === true, myJobUrl: `${CUSTOMER_BASE}/my-job/${link.token}`,
  };
  if (job.source === "qa_test") {
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail } = await import("./test-send.server");
    const mail = renderInstallBookedEmail({ ...input, test: true });
    const r = await sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: isTestPartner(biz), label: `install_booked:${startIso}${opts.depositReceived ? ":deposit-received" : ""}`, actorId: null }, owner?.email ?? "", mail.subject, mail.html, mail.text);
    return `${r.status}: ${r.detail}`;
  }
  if (!INSTALL_BOOKED_EMAIL_APPROVED) {
    await logEvent(jobId, null, "install_booked_email_not_sent", "Install booked — the booked email wording is awaiting approval, so no email was sent", { starts_at: startIso }, { internal: true });
    return "not sent — wording awaiting approval";
  }
  if (!owner?.email) return "not sent — no owner email";
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  try { await assertCustomerDeliveryAllowed(jobId, "Install booked email"); } catch (e) { return `not sent — ${(e as Error).message}`; }
  return (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
    jobId, jobSource: job.source, to: owner.email, purpose: "install_booked", key: `install-booked:v1:${jobId}:${startIso}${opts.depositReceived ? ":deposit-received" : ""}`,
    build: () => renderInstallBookedEmail({ ...input, test: false }),
  });
}
