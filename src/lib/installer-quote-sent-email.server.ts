// "Quote sent" email to the installer's business office (Jo 5 Nov 2026 22:45). Called from `releaseQuoteToOwner`
// (office-quote-review.server) once the quote is committed as sent and the owner has been told — detached with the
// request's waitUntil, otherwise inline — for every quote; this module decides (installer's own customer, installation
// quote, sent, job open) and does nothing for HIV leads. Same shape as the "Enter your price" email
// (boss-price-link.server): ONE `customer_email_sends` attempt per quote (`installerQuoteSentKey`) claimed BEFORE the
// `installer_quote_sent_email` event and the send; held reasons (flag off / no office email / trade messages paused) are
// recorded ONCE as `installer_quote_sent_email_held` and retried on a later run; TEST jobs / TEST partners → test-send;
// real partners → `sendOfficeEmail` (the one partner email sender, master switch + trade pause inside it).
// Never throws to its caller; never changes a stage or a quote.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import {
  INSTALLER_QUOTE_SENT_EMAIL_APPROVED, INSTALLER_QUOTE_SENT_EVENT, INSTALLER_QUOTE_SENT_HELD_EVENT, INSTALLER_QUOTE_SENT_PURPOSE,
  firstNameOf, installerQuoteSentKey, installerQuoteSentLink, installerQuoteSentPlan, renderInstallerQuoteSentEmail,
} from "./installer-quote-sent-email.core";

type JobRow = { id: string; job_number: string; source: string | null; channel: string | null; deleted_at: string | null; originating_installer_business_id: string | null; properties: { address_line: string | null; suburb: string | null; postcode: string | null } | null; owners: { full_name: string | null } | null };
type QuoteRow = { id: string; kind: string; status: string | null; sent_at: string | null; customer_total_inc_gst: number | string | null };
type BizRow = { id: string; name: string | null; signer_name: string | null; email: string | null; onboarding_notes: string | null };

export async function emailInstallerQuoteSent(jobId: string, quoteId: string, opts: { approved?: boolean } = {}): Promise<string> {
  try {
    const key = installerQuoteSentKey(quoteId);
    const [{ data: job }, { data: quote }, { data: attempt }] = await Promise.all([
      admin.from("jobs").select("id, job_number, source, channel, deleted_at, originating_installer_business_id, properties(address_line, suburb, postcode), owners(full_name)").eq("id", jobId).maybeSingle(),
      admin.from("quotes").select("id, kind, status, sent_at, customer_total_inc_gst").eq("id", quoteId).eq("job_id", jobId).maybeSingle(),
      admin.from("customer_email_sends").select("id").eq("job_id", jobId).eq("idempotency_key", key).maybeSingle(),
    ]);
    const j = job as unknown as JobRow | null;
    const q = quote as unknown as QuoteRow | null;
    if (!j) return "skipped: job not found";
    if (!q) return "skipped: quote not found";
    // Cheap refusals first (HIV leads, fixes quotes, unsent, closed) — no business read, nothing recorded.
    const pre = installerQuoteSentPlan({ channel: j.channel, kind: q.kind, sentAt: q.sent_at, deleted: !!j.deleted_at, approved: true, test: true, officeEmail: "x", paused: null, alreadyAttempted: !!attempt });
    if (pre.action === "skip") return `skipped: ${pre.reason}`;
    if (pre.action === "done") return "email already attempted";
    if (!j.originating_installer_business_id) return "skipped: no installer business on the job";
    const { data: biz } = await admin.from("businesses").select("id, name, signer_name, email, onboarding_notes").eq("id", j.originating_installer_business_id).maybeSingle();
    const b = (biz ?? null) as BizRow | null;
    const { isTestPartner } = await import("./test-send.core");
    const test = j.source === "qa_test" || isTestPartner(b ?? {});
    // Jo 30 Oct 2026: "Pause all trade messages" — held BEFORE the claim (TEST unchanged), so a later run can still send it.
    const tradePaused = test ? null : await (await import("./trade-pause.server")).tradeMessagesPausedNow({ jobId, businessId: b?.id ?? j.originating_installer_business_id });
    const plan = installerQuoteSentPlan({ channel: j.channel, kind: q.kind, sentAt: q.sent_at, deleted: !!j.deleted_at, approved: opts.approved ?? INSTALLER_QUOTE_SENT_EMAIL_APPROVED, test, officeEmail: b?.email, paused: tradePaused, alreadyAttempted: !!attempt });
    if (plan.action === "skip") return `skipped: ${plan.reason}`;
    if (plan.action === "done") return "email already attempted";
    if (plan.action === "held") {
      const { data: held } = await admin.from("workflow_events").select("id, details").eq("job_id", jobId).eq("event_type", INSTALLER_QUOTE_SENT_HELD_EVENT);
      const heldBefore = ((held ?? []) as { details: unknown }[]).some((e) => (e.details as { key?: string } | null)?.key === key);
      if (!heldBefore) await logEvent(jobId, null, INSTALLER_QUOTE_SENT_HELD_EVENT, `"Quote sent" email to the installer's office not sent — ${plan.reason}. Retried the next time this quote's release runs.`, { key, quote_id: quoteId, business_id: b?.id ?? j.originating_installer_business_id, reason: plan.reason }, { internal: true });
      return `held: ${plan.reason}`;
    }
    // Claim the one attempt per quote BEFORE the event and the send; a lost race means another run already has it.
    const claim = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: INSTALLER_QUOTE_SENT_PURPOSE, idempotency_key: key }).select("id").maybeSingle();
    if (claim.error || !claim.data) return "email already attempted";
    await logEvent(jobId, null, INSTALLER_QUOTE_SENT_EVENT, `Installer's office emailed "Quote sent" for ${j.job_number} (Jo 5 Nov 2026) — email prepared`, { key, quote_id: quoteId, business_id: b?.id ?? j.originating_installer_business_id, to: plan.to }, { internal: true });
    const { SET_PASSWORD_BASE } = await import("./set-password-link.core");
    const { TEST_APP_BASE, sendTestEmail } = await import("./test-send.server");
    const base = test ? TEST_APP_BASE : SET_PASSWORD_BASE;
    const { quoteExpiresAt } = await import("./quote-expiry.core");
    const { lastValidInstant } = await import("./owner-quote-email.core");
    const p = j.properties;
    const address = [p?.address_line?.trim(), [p?.suburb?.trim(), p?.postcode?.trim() ? `VIC ${p.postcode.trim()}` : null].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "the property";
    const ownerFull = j.owners?.full_name?.trim() || "the owner";
    const m = renderInstallerQuoteSentEmail({
      recipientFirst: firstNameOf(b?.signer_name), ownerFirst: ownerFull === "the owner" ? null : firstNameOf(ownerFull), ownerFull,
      jobNumber: j.job_number, address, totalIncGst: Number(q.customer_total_inc_gst ?? 0),
      validUntil: lastValidInstant(quoteExpiresAt(q.sent_at as string)), quoteUrl: installerQuoteSentLink(base, jobId), test,
    });
    const r = test
      ? await sendTestEmail({ jobId, jobSource: j.source, partnerIsTest: isTestPartner(b ?? {}), label: key, actorId: null }, plan.to, m.subject, m.html, m.text)
      : await (await import("./office-email.server")).sendOfficeEmail({ actorId: null, recipient: "partner", to: plan.to, contactName: b?.name ?? null, subject: m.subject, message: m.text, label: INSTALLER_QUOTE_SENT_PURPOSE, record: { businessId: b?.id ?? j.originating_installer_business_id }, html: m.html, text: m.text, idempotencyKey: key, pauseJobId: jobId });
    // The claim row stays either way (one attempt per quote); only its status records the outcome.
    await admin.from("customer_email_sends").update({ status: r.status === "sent" ? "sent" : "failed", sent_at: r.status === "sent" ? new Date().toISOString() : null, error: r.status === "sent" ? null : r.detail ?? null }).eq("id", claim.data.id);
    return `email${test ? " (test)" : ""} ${r.status}: ${r.detail}`;
  } catch (e) { return `installer "Quote sent" email not sent — ${(e as Error).message}`; }
}
