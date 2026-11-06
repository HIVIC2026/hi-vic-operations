// Jo 24 Oct 2026: once per accepted quote, email the job's installer. Jo 28 Oct 2026: sent once the owner has PAID the
// safety check (emailInstallerOnSafetyCheckPaid, called from afterPaymentsChanged), not when the quote is accepted. Through the office sender, so it pauses with the
// master switch; TEST jobs / TEST partners go only to Jo's TEST inbox. Never blocks payment processing.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export async function emailInstallerQuoteAccepted(jobId: string, quoteId: string): Promise<string> {
  const { INSTALLER_ACCEPTED_EMAIL_APPROVED, renderInstallerAcceptedEmail } = await import("./installer-accepted-email.core");
  if (!INSTALLER_ACCEPTED_EMAIL_APPROVED) return "not approved";
  const { count, error: historyError } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "installer_accepted_email").contains("details", { quote_id: quoteId });
  // Fails closed: unknown history sends nothing (the next payment follow-up or Xero poll tries again).
  if (historyError || count == null) return "skipped — could not check whether it was already sent";
  if (count) return "already sent";
  const [{ data: job }, { data: asg }] = await Promise.all([
    admin.from("jobs").select("job_number, source, channel, originating_installer_business_id, owners(full_name), properties(address_line, suburb)").eq("id", jobId).single(),
    admin.from("job_assignments").select("user_id, business_id, profiles:user_id(full_name, email), businesses(onboarding_notes)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]);
  const prof = (asg?.profiles ?? null) as { full_name: string | null; email: string | null } | null;
  if (job?.channel === 'installer_sourced') {
    const { approvedOwnMessage } = await import('./own-customer-messages.server');
    if (!(await approvedOwnMessage('own_installer_owner_accepted'))) return 'awaiting wording approval';
    if (await (await import('./qa-inbox.server')).qaDeliveryHeld(jobId)) return 'TEST delivery held';
    if (!asg?.business_id || asg.business_id !== job.originating_installer_business_id) return 'own installer not assigned';
    // Direct callers must meet the same payment gate as the canonical payment trigger.
    const v = await (await import('./payments.server')).jobPaymentView(jobId);
    if (!v || v.steps.find(s => s.key === 'safety_check')?.state !== 'paid' || !v.invoiceId) return 'not due — safety check not paid';
    const { data: invoice, error: ie } = await admin.from('invoices').select('quote_id, quotes(status)').eq('id', v.invoiceId).eq('job_id', jobId).maybeSingle();
    const quote = invoice?.quotes as { status?: string } | { status?: string }[] | null;
    if (ie || invoice?.quote_id !== quoteId || (Array.isArray(quote) ? quote[0]?.status : quote?.status) !== 'accepted') return 'not due — quote not accepted';
    const { data: biz, error: be } = await admin.from('businesses').select('name, trading_name').eq('id', asg.business_id).maybeSingle();
    if (be || !biz) throw new Error('Installer office could not be checked.');
    const p = job.properties as { address_line?: string; suburb?: string } | null;
    const mail = (await import('./own-customer-quote-messages.core')).renderOwnInstallerAcceptedEmail({ name: biz.trading_name || biz.name, jobNumber: job.job_number, address: [p?.address_line, p?.suburb].filter(Boolean).join(', ') || job.job_number });
    return (await (await import('./own-job-piesa-notices.server')).emailInstallerOffice({ jobId, businessId: asg.business_id, key: `installer-owner-accepted:v1:${quoteId}`, ...mail, rendered: mail, approved: true })).status;
  }
  if (!job || !asg || !prof?.email) return "no installer email";
  const p = job.properties as { address_line: string | null; suburb: string | null } | null;
  const address = [p?.address_line, p?.suburb].filter(Boolean).join(", ") || null;
  const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
  const { isTestPartner } = await import("./test-send.core");
  const test = job.source === "qa_test" || isTestPartner(asg.businesses as never);
  const mail = renderInstallerAcceptedEmail({ installerFirstName: prof.full_name?.split(/\s+/)[0] ?? null, ownerName: (job.owners as { full_name: string | null } | null)?.full_name ?? null, address, jobNumber: job.job_number, jobUrl: `${SET_PASSWORD_BASE}/field/${jobId}`, test });
  // Launch fix (7 Nov): claim BEFORE sending (same once-only reservation as the install deposit office email). A card
  // payment's two Stripe deliveries can run this at the same moment; the unique key lets only one of them send.
  const key = `installer-accepted:v1:${quoteId}`;
  const claim = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: "installer_quote_accepted", idempotency_key: key }).select("id").maybeSingle();
  if (claim.error?.code === "23505") return "already sent";
  if (claim.error || !claim.data) return "skipped — could not reserve the email";
  const claimId = (claim.data as { id: string }).id;
  let status: string, detail: string;
  if (test) {
    const r = await (await import("./test-send.server")).sendTestEmail({ jobId, jobSource: job.source, partnerIsTest: true, label: `installer_accepted:${quoteId}`, actorId: null } as never, prof.email, mail.subject, mail.html, mail.text);
    status = r.status; detail = r.detail;
  } else {
    const r = await (await import("./office-email.server")).sendOfficeEmail({ actorId: null as unknown as string, recipient: "partner", to: prof.email, contactName: prof.full_name, subject: mail.subject, message: mail.text, label: "installer_quote_accepted", record: { businessId: asg.business_id }, html: mail.html, text: mail.text });
    // Jo 30 Oct 2026: a "Pause all trade messages" hold is recorded by the sender but never claims this quote's email:
    // the reservation is released so it goes once the pause lifts.
    if (r.status === "blocked" && (await import("./trade-pause.core")).isTradePauseHold(r.detail)) {
      await admin.from("customer_email_sends").delete().eq("id", claimId).eq("status", "sending");
      return `held: ${r.detail}`;
    }
    status = r.status; detail = r.detail;
  }
  await admin.from("customer_email_sends").update({ status: status === "sent" ? "sent" : status === "blocked" || status === "failed" && /didn't accept|refused this address or message/i.test(detail ?? "") ? "failed" : "delivered_unrecorded",
    sent_at: status === "sent" ? new Date().toISOString() : null, error: status === "sent" ? null : detail }).eq("id", claimId);
  await logEvent(jobId, null, "installer_accepted_email", `Installer told the owner accepted (${status}: ${detail})`, { quote_id: quoteId, status, to: prof.email }, { internal: true });
  return status;
}

/** Called when the safety-check payment lands: sends the installer email for the invoice's accepted quote (once per quote). */
export async function emailInstallerOnSafetyCheckPaid(jobId: string, invoiceId: string): Promise<string> {
  // Same due check as the owner's O22 email: the current invoice, safety check paid, and paid recently.
  const { jobPaymentView } = await import("./payments.server");
  const { safetyCheckPaidAt, youreInDue } = await import("./owner-email-triggers.core");
  const v = await jobPaymentView(jobId);
  const step = v?.steps.find((s) => s.key === "safety_check");
  if (!v || v.invoiceId !== invoiceId || step?.state !== "paid") return "not due — safety check not paid on this invoice";
  const paidAt = safetyCheckPaidAt(v.ledger, v.plan.thresholds.safety_check);
  const { data: job } = await admin.from("jobs").select("stage, deleted_at").eq("id", jobId).maybeSingle();
  if (!job || !paidAt || !youreInDue({ paidAt, stage: job.stage as string, deletedAt: job.deleted_at }, new Date())) return "not due — no recent safety check payment";
  const { data: inv } = await admin.from("invoices").select("quote_id, quotes(status)").eq("id", invoiceId).maybeSingle();
  const quoteId = (inv?.quote_id as string | null) ?? null;
  if (!quoteId) return "not due — no quote";
  const q = inv?.quotes as { status: string | null } | { status: string | null }[] | null;
  const status = Array.isArray(q) ? q[0]?.status : q?.status;
  if (status !== "accepted") return "not due — quote not accepted";
  return emailInstallerQuoteAccepted(jobId, quoteId);
}
