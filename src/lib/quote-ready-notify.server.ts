// Stage 6 (Jo 22 Oct 2026): once a released installation quote exists, tell the owner — by text, and by
// email only when an approved template is on file. Nothing here invents customer wording:
//  • the text uses the `quote_ready` type, whose wording is NOT approved yet, so the real sender refuses it
//    until Jo approves it (sms.core.ts). The draft below is what she would be approving.
//  • the email is the rendered owner quote email (owner-quote-email.core.ts: real numbers, lines and the secure
//    My job link) once OWNER_QUOTE_EMAIL_APPROVED is true; until then only an approved
//    `customer_communication_templates` row may be sent, and with none on file the office is told the quote went
//    out with no email, instead of a made-up one. TEST jobs always get the rendered draft through test-send.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export const QUOTE_EMAIL_TEMPLATE_KEY = "quote_ready";
/** DRAFT wording (never sent until Jo approves the `quote_ready` SMS type). */
export const quoteReadySmsBody = (jobNumber: string) =>
  `Your ceiling insulation quote is ready — please open your Home Insulation Victoria job page to see it (job ${jobNumber}). Reply STOP to opt out.`;

export type QuoteNotifyResult = { sms: string; email: string };

type OwnerQuoteFacts = {
  input: Omit<import("./owner-quote-email.core").OwnerQuoteEmailInput, "unsubscribeUrl" | "test"> | null;
  /** Why the rendered email cannot be built (no usable link / no total). */
  missing: string | null;
};

/** Everything the owner quote email needs, read-only. A missing secure link or total returns `missing`, never a guess. */
async function loadOwnerQuoteFacts(jobId: string, quoteId: string, ownerName: string | null, propertyId: string | null): Promise<OwnerQuoteFacts> {
  const [{ data: quote, error: qe }, { data: items, error: ie }, { data: link, error: le }, { data: prop, error: pe }] = await Promise.all([
    admin.from("quotes").select("customer_total_inc_gst, veec_discount_inc_gst, subtotal_inc_gst, sent_at, kind").eq("id", quoteId).eq("job_id", jobId).maybeSingle(),
    admin.from("quote_items").select("description, line_total_inc_gst, sort").eq("quote_id", quoteId),
    admin.from("customer_estimate_links").select("token,status,expires_at").eq("job_id", jobId).eq("purpose", "step3_estimate").eq("status", "active").maybeSingle(),
    propertyId ? admin.from("properties").select("address_line, suburb, postcode").eq("id", propertyId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  const { linkUsable } = await import("./estimatelink.core");
  if (qe || le || !quote || quote.customer_total_inc_gst == null || !Number.isFinite(Number(quote.customer_total_inc_gst))) return { input: null, missing: "quote total unavailable" };
  if (!link || !linkUsable(link)) return { input: null, missing: "owner secure link missing" };
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { fullAddress } = await import("./address");
  const { firstName } = await import("./worker-links.core");
  const { quoteExpiresAt } = await import("./quote-expiry.core");
  const { lastValidInstant, safetyCheckPriceFromLines } = await import("./owner-quote-email.core");
  // Lines/address are best-effort presentation: a failed read shows fewer details, never a wrong number.
  const lines = ie ? [] : [...(items ?? [])].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0)).map((l) => ({ description: String(l.description ?? ""), lineTotalIncGst: Number(l.line_total_inc_gst) }));
  const address = pe || !prop ? null : fullAddress(prop.address_line, prop.suburb, prop.postcode) || null;
  // Jo 24 Oct: what the owner is getting — area, removal, product and the (approved, so EEC-certified) installer.
  // Best-effort like the lines above: a failed read leaves a detail out, never stops the email.
  const extra = await (async () => Promise.all([
    admin.from("ceiling_measurements").select("measured_area_m2, verified_area_m2, removal_required, removal_m2").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "mitti_product_recorded").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("job_assignments").select("businesses(name, trading_name, onboarding_status, is_active)").eq("job_id", jobId).eq("role", "installer").eq("active", true).limit(1).maybeSingle(),
  ]))().catch(() => [{ data: null }, { data: null }, { data: null }] as const);
  const [{ data: m }, { data: prod }, { data: asg }] = extra as unknown as [{ data: { measured_area_m2: unknown; verified_area_m2: unknown; removal_required: boolean | null; removal_m2: unknown } | null }, { data: { details: unknown } | null }, { data: { businesses: unknown } | null }];
  const biz = (asg?.businesses ?? null) as { name: string | null; trading_name: string | null; onboarding_status: string | null; is_active: boolean | null } | null;
  const area = m ? Number(m.verified_area_m2 ?? m.measured_area_m2) || null : null;
  const product = ((prod?.details as { product?: { option?: string } } | null)?.product?.option ?? null);
  return {
    missing: null,
    input: {
      firstName: firstName(ownerName), address,
      totalIncGst: Number(quote.customer_total_inc_gst),
      rebateIncGst: quote.veec_discount_inc_gst == null ? null : Number(quote.veec_discount_inc_gst),
      lines, quoteUrl: `${CUSTOMER_BASE}/my-job/${link.token}?screen=quote`,
      validUntil: quote.kind === "installation" && quote.sent_at ? lastValidInstant(quoteExpiresAt(quote.sent_at)) : null,
      officePhone: null, safetyCheckPrice: safetyCheckPriceFromLines(lines),
      subtotalIncGst: quote.subtotal_inc_gst == null ? null : Number(quote.subtotal_inc_gst),
      areaM2: area, removalM2: m?.removal_required ? Number(m.removal_m2) || null : null, product,
      installerName: biz?.trading_name ?? biz?.name ?? null, installerCertified: biz?.onboarding_status === "approved" && biz.is_active === true,
    },
  };
}

export async function notifyOwnerQuoteReady(jobId: string, quoteId: string, kind: string): Promise<QuoteNotifyResult> {
  if (kind !== "installation") return { sms: "skipped", email: "skipped" };
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  await assertCustomerDeliveryAllowed(jobId, "Office quote notification");
  const { data: job } = await admin.from("jobs").select("owner_id, property_id, job_number, source, stage, deleted_at, qa_archived_at").eq("id", jobId).maybeSingle();
  if (!job) return { sms: "skipped", email: "skipped" };
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job)) return { sms: "skipped", email: "skipped" };
  const { data: owner } = await admin.from("owners").select("phone, email, full_name").eq("id", job.owner_id).maybeSingle();
  const { renderOwnerQuoteEmail, ownerQuoteSms, OWNER_QUOTE_EMAIL_APPROVED } = await import("./owner-quote-email.core");

  if (job.source === "qa_test") {
    const { data: assigned, error: ae } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
    const { data: partner, error: pe } = assigned?.business_id ? await admin.from("businesses").select("onboarding_notes").eq("id", assigned.business_id).maybeSingle() : { data: null, error: null };
    if (ae || pe) throw new Error("TEST partner could not be checked.");
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    const facts = await loadOwnerQuoteFacts(jobId, quoteId, owner?.full_name ?? null, job.property_id ?? null);
    if (!facts.input) throw new Error("TEST quote total or owner link is unavailable.");
    // TEST may show the draft wording regardless of approval; the unsubscribe link is best-effort here.
    const unsubscribe = await (await import("./emailsafety.server")).unsubscribeUrlForJob(jobId).catch(() => null);
    const mail = renderOwnerQuoteEmail({ ...facts.input, unsubscribeUrl: unsubscribe, test: true });
    const { aud } = await import("./workflow");
    const ctx = { jobId, jobSource: job.source, partnerIsTest: isTestPartner(partner), label: `quote_ready:${quoteId}`, actorId: null };
    const email = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    const sms = await sendTestSms(ctx, owner?.phone ?? "", ownerQuoteSms(facts.input.firstName, aud(facts.input.totalIncGst), facts.input.quoteUrl));
    return { email: `${email.status}: ${email.detail}`, sms: `${sms.status}: ${sms.detail}` };
  }

  const { sendRealSms } = await import("./sms.server");
  const s = await sendRealSms({
    type: "quote_ready", idempotencyKey: `quote-ready:v1:${quoteId}`, to: owner?.phone ?? null, jobId,
    body: quoteReadySmsBody(String(job.job_number ?? "")),
  }).catch((e) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : "error", sid: null }));

  // Approved rendered email wins; until Jo approves it only an approved DB template may be sent.
  const facts = OWNER_QUOTE_EMAIL_APPROVED ? await loadOwnerQuoteFacts(jobId, quoteId, owner?.full_name ?? null, job.property_id ?? null) : null;
  const { data: tpl } = OWNER_QUOTE_EMAIL_APPROVED ? { data: null } : await admin.from("customer_communication_templates").select("subject, body_markdown")
    .eq("template_key", QUOTE_EMAIL_TEMPLATE_KEY).eq("status", "approved").order("version", { ascending: false }).limit(1).maybeSingle();
  const wording = OWNER_QUOTE_EMAIL_APPROVED ? (facts?.input ? "rendered" : null) : tpl ? "template" : null;
  let email = OWNER_QUOTE_EMAIL_APPROVED ? `not sent — ${facts?.missing ?? "quote details unavailable"}` : "no approved wording — not sent";
  if (wording && owner?.email) {
    const [{ data: opt, error: oe }, { data: response, error: re }, { count: suppressed, error: se }] = await Promise.all([
      admin.from("customer_email_optouts").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
      admin.from("lead_campaign_responses").select("opted_out_at").eq("job_id", jobId).maybeSingle(),
      admin.from("customer_engagement_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).in("event_type", (await import("./emailsafety.core")).SUPPRESSING_EVENTS),
    ]);
    const boundary = (await import("./comms-test-recipient.core")).testRecipientBoundary(owner.email, job.source);
    if (oe || re || se || suppressed == null || opt?.opted_out_at || response?.opted_out_at || suppressed > 0 || boundary.status === "blocked") email = "blocked — not sent";
    else {
      const key = `quote-ready-email:v1:${quoteId}`;
      const { data: reserved, error } = await admin.from("customer_email_sends").insert({ job_id: jobId, purpose: "quote_ready", idempotency_key: key }).select("id").single();
      if (error || !reserved) email = "already attempted — not resent";
      else {
        const { unsubscribeUrlForJob } = await import("./emailsafety.server");
        const unsubscribe = await unsubscribeUrlForJob(jobId);
        const mail = wording === "rendered" && facts?.input
          ? renderOwnerQuoteEmail({ ...facts.input, unsubscribeUrl: unsubscribe, test: false })
          : { subject: tpl!.subject, html: tpl!.body_markdown, text: tpl!.body_markdown };
        const { resendSend } = await import("./hot-leads-send.server");
        const d = await resendSend(owner.email, mail.subject, mail.html, mail.text, key, unsubscribe).catch(() => null);
        const status = !d || d.outcome === "uncertain" ? "delivered_unrecorded" : d.outcome === "rejected" || d.outcome === "not_attempted" ? "failed" : "sent";
        await admin.from("customer_email_sends").update({ status, provider: "resend", sent_at: status === "sent" ? new Date().toISOString() : null, error: d?.detail ?? "Delivery result unknown", provider_message_id: d && "id" in d ? d.id ?? null : null }).eq("id", reserved.id);
        email = status === "sent" ? "sent" : status === "delivered_unrecorded" ? "delivery uncertain — not retried" : `failed: ${d?.detail ?? "send error"}`;
      }
    }
  }
  if (OWNER_QUOTE_EMAIL_APPROVED && !facts?.input) {
    const linkMissing = facts?.missing === "owner secure link missing";
    await logEvent(jobId, null, "ready_check_needs_office", linkMissing
      ? "Quote released to the owner — the owner has no working secure My job link, so no quote email was sent"
      : "Quote released to the owner — the quote total could not be read, so no quote email was sent",
    { quote_id: quoteId, needs_office: true, reason: linkMissing ? "owner_link_missing" : "quote_total_unavailable" }, { internal: true });
  }
  if (!OWNER_QUOTE_EMAIL_APPROVED && !tpl) {
    await logEvent(jobId, null, "ready_check_needs_office", "Quote released to the owner — no approved quote email wording on file, so no email was sent",
      { quote_id: quoteId, needs_office: true }, { internal: true });
  }
  return { sms: `${s.status}: ${s.detail}`, email };
}
