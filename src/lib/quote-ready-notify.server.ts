// Stage 6 (Jo 22 Oct 2026): once a released installation quote exists, tell the owner — by text, and by
// email only when an approved template is on file. Nothing here invents customer wording:
//  • the text is the approved `quote_ready` wording (decision 87, text B: ownerQuoteSms) through the one real sender,
//    which still needs customer_comms_enabled + the quote_ready switch; it carries the secure My job link, so with no
//    usable link nothing is texted.
//  • the email is the rendered owner quote email (owner-quote-email.core.ts: real numbers, lines and the secure
//    My job link) once OWNER_QUOTE_EMAIL_APPROVED is true; until then only an approved
//    `customer_communication_templates` row may be sent, and with none on file the office is told the quote went
//    out with no email, instead of a made-up one. TEST jobs always get the rendered draft through test-send.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

export const QUOTE_EMAIL_TEMPLATE_KEY = "quote_ready";
/** The approved quote-ready text (decision 87, B) lives in owner-quote-email.core.ts as ownerQuoteSms. */
export { ownerQuoteSms as quoteReadySmsBody } from "./owner-quote-email.core";

export type QuoteNotifyResult = { sms: string; email: string };

type OwnerQuoteFacts = {
  input: Omit<import("./owner-quote-email.core").OwnerQuoteEmailInput, "unsubscribeUrl" | "test"> | null;
  /** Why the rendered email cannot be built (no usable link / no total). */
  missing: string | null;
};

/** Everything the owner quote email needs, read-only. A missing secure link or total returns `missing`, never a guess. */
export async function loadOwnerQuoteFacts(jobId: string, quoteId: string, ownerName: string | null, propertyId: string | null): Promise<OwnerQuoteFacts> {
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

/** The quote text is still worth sending only while that quote is issued and released (decision 165; batch 2 7am send). */
export const quoteStillReleased = (q: { status?: string | null; release_state?: string | null } | null | undefined) => q?.status === "issued" && q?.release_state === "released";

/** Key ending for this quote's quote-ready text and email: none for the first send, `:r${n}` after the n-th office reopen of
 *  the declined quote, so a re-sent quote is a new send. Shared by the sender and the 7am held-text sweep. Throws if unreadable. */
export async function currentQuoteReadyKeySuffix(jobId: string, quoteId: string): Promise<string> {
  const { data, error } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", "quote_reopened_by_office").contains("details", { quote_id: quoteId });
  if (error) throw new Error(`Quote reopen count could not be read: ${error.message}`);
  const n = (data ?? []).length;
  return n > 0 ? `:r${n}` : "";
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
    // Partner verification and quote facts are independent reads. Keep partner
    // refusal first, and keep unsubscribe preparation and both sends sequential.
    const [partnerRead, factsRead] = await Promise.all([
      (async () => {
        const { data: assigned, error: ae } = await admin.from("job_assignments").select("business_id").eq("job_id", jobId).eq("role", "installer").eq("active", true).maybeSingle();
        const { data: partner, error: pe } = assigned?.business_id ? await admin.from("businesses").select("onboarding_notes").eq("id", assigned.business_id).maybeSingle() : { data: null, error: null };
        if (ae || pe) throw new Error("TEST partner could not be checked.");
        return partner;
      })().then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })),
      loadOwnerQuoteFacts(jobId, quoteId, owner?.full_name ?? null, job.property_id ?? null)
        .then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })),
    ]);
    if (!partnerRead.ok) throw partnerRead.error;
    if (!factsRead.ok) throw factsRead.error;
    const partner = partnerRead.value;
    const facts = factsRead.value;
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    if (!facts.input) throw new Error("TEST quote total or owner link is unavailable.");
    // TEST may show the draft wording regardless of approval; the unsubscribe link is best-effort here.
    const unsubscribe = await (await import("./emailsafety.server")).unsubscribeUrlForJob(jobId).catch(() => null);
    const mail = renderOwnerQuoteEmail({ ...facts.input, unsubscribeUrl: unsubscribe, test: true });
    const ctx = { jobId, jobSource: job.source, partnerIsTest: isTestPartner(partner), label: `quote_ready:${quoteId}`, actorId: null };
    const email = await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text);
    const sms = await sendTestSms(ctx, owner?.phone ?? "", ownerQuoteSms(facts.input.firstName, facts.input.quoteUrl));
    return { email: `${email.status}: ${email.detail}`, sms: `${sms.status}: ${sms.detail}` };
  }

  const { sendRealSms } = await import("./sms.server");
  // The release-state and reopen-key reads do not depend on one another.
  // Capture the key error so its existing refusal still precedes quote facts/sends.
  const [suffix, { data: q }] = await Promise.all([
    currentQuoteReadyKeySuffix(jobId, quoteId).then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })),
    admin.from("quotes").select("sent_at, status, release_state").eq("id", quoteId).eq("job_id", jobId).maybeSingle(),
  ]);
  if (!suffix.ok) return { sms: `failed: ${suffix.error instanceof Error ? suffix.error.message : "error"}`, email: "not sent — quote reopen count unavailable" };
  const keySuffix = suffix.value;
  // Decision 165: the trigger is the quote release (sent_at). A switch flipped on days later must not text an old
  // release, and never one that has since been accepted/declined/reopened — so the sender gets the release time and state.
  // The approved text (decision 87) carries the secure My job link, so the same facts the email uses are read first.
  const loaded = await loadOwnerQuoteFacts(jobId, quoteId, owner?.full_name ?? null, job.property_id ?? null);
  const s = loaded.input
    ? await sendRealSms({
        type: "quote_ready", idempotencyKey: `quote-ready:v1:${quoteId}${keySuffix}`, to: owner?.phone ?? null, jobId,
        body: ownerQuoteSms(loaded.input.firstName, loaded.input.quoteUrl),
        event: { at: q?.sent_at ?? null, current: quoteStillReleased(q) },
      }).catch((e) => ({ status: "failed" as const, detail: e instanceof Error ? e.message : "error", sid: null }))
    : { status: "blocked" as const, detail: `not sent — ${loaded.missing}`, sid: null };

  // Approved rendered email wins; until Jo approves it only an approved DB template may be sent.
  const facts = OWNER_QUOTE_EMAIL_APPROVED ? loaded : null;
  const { data: tpl } = OWNER_QUOTE_EMAIL_APPROVED ? { data: null } : await admin.from("customer_communication_templates").select("subject, body_markdown")
    .eq("template_key", QUOTE_EMAIL_TEMPLATE_KEY).eq("status", "approved").order("version", { ascending: false }).limit(1).maybeSingle();
  const wording = OWNER_QUOTE_EMAIL_APPROVED ? (facts?.input ? "rendered" : null) : tpl ? "template" : null;
  let email = OWNER_QUOTE_EMAIL_APPROVED ? `not sent — ${facts?.missing ?? "quote details unavailable"}` : "no approved wording — not sent";
  if (wording && owner?.email) {
    email = await (await import("./owner-email-send.server")).sendGuardedOwnerEmail({
      jobId, jobSource: job.source, to: owner.email, purpose: "quote_ready", key: `quote-ready-email:v1:${quoteId}${keySuffix}`,
      build: (unsubscribe) => wording === "rendered" && facts?.input
        ? renderOwnerQuoteEmail({ ...facts.input, unsubscribeUrl: unsubscribe, test: false })
        : { subject: tpl!.subject, html: tpl!.body_markdown, text: tpl!.body_markdown },
    });
  }
  if (OWNER_QUOTE_EMAIL_APPROVED && !facts?.input) {
    const linkMissing = facts?.missing === "owner secure link missing";
    await logEvent(jobId, null, "ready_check_needs_office", linkMissing
      ? "Quote released to the owner — the owner has no working secure My job link, so no quote email or text was sent"
      : "Quote released to the owner — the quote total could not be read, so no quote email or text was sent",
    { quote_id: quoteId, needs_office: true, reason: linkMissing ? "owner_link_missing" : "quote_total_unavailable" }, { internal: true });
  }
  if (!OWNER_QUOTE_EMAIL_APPROVED && !tpl) {
    await logEvent(jobId, null, "ready_check_needs_office", "Quote released to the owner — no approved quote email wording on file, so no email was sent",
      { quote_id: quoteId, needs_office: true }, { internal: true });
  }
  return { sms: `${s.status}: ${s.detail}`, email };
}
