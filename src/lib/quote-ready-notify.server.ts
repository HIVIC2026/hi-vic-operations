// Stage 6 (Jo 22 Oct 2026): once a released installation quote exists, tell the owner — by text, and by
// email only when an approved template is on file. Nothing here invents customer wording:
//  • the text is the approved `quote_ready` wording (decision 87, text B: ownerQuoteSms) through the one real sender,
//    which still needs customer_comms_enabled + the quote_ready switch; it carries the secure My job link, so with no
//    usable link nothing is texted.
//  • the email is the rendered owner quote email (owner-quote-email.core.ts: real numbers, lines and the secure
//    My job link) once OWNER_QUOTE_EMAIL_APPROVED is true; until then only an approved
//    `customer_communication_templates` row may be sent, and with none on file the office is told the quote went
//    out with no email, instead of a made-up one. TEST jobs always get the rendered draft through test-send.
//  • decision #29/#33 (Jo 2 Nov 2026): with OWNER_QUOTE_EMAIL_V4_APPROVED on, a 30-day quote gets the v4 email (same
//    purpose + key) with the "What's changed from your estimate" box and the quote documents attached (Customer
//    Agreement + payment terms, Statement of rights); if any document can't be made the email is HELD ("Quote documents
//    not ready") with an office note, never sent without them. Flag off, or a 14-day quote: the v3 email, unchanged.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { genericMail } from './mail-mjml.core';

export const QUOTE_EMAIL_TEMPLATE_KEY = "quote_ready";
/** The approved quote-ready text (decision 87, B) lives in owner-quote-email.core.ts as ownerQuoteSms. */
export { ownerQuoteSms as quoteReadySmsBody } from "./owner-quote-email.core";

export type QuoteNotifyResult = { sms: string; email: string };

type OwnerQuoteFacts = {
  input: Omit<
    import("./owner-quote-email.core").OwnerQuoteEmailInput,
    "unsubscribeUrl" | "test"
  > | null;
  /** Why the rendered email cannot be built (no usable link / no total). */
  missing: string | null;
};

/** Everything the owner quote email needs, read-only. A missing secure link or total returns `missing`, never a guess. */
export async function loadOwnerQuoteFacts(
  jobId: string,
  quoteId: string,
  ownerName: string | null,
  propertyId: string | null,
): Promise<OwnerQuoteFacts> {
  const [
    { data: quote, error: qe },
    { data: items, error: ie },
    { data: link, error: le },
    { data: prop, error: pe },
  ] = await Promise.all([
    admin
      .from("quotes")
      .select("customer_total_inc_gst, veec_discount_inc_gst, subtotal_inc_gst, sent_at, kind")
      .eq("id", quoteId)
      .eq("job_id", jobId)
      .maybeSingle(),
    admin
      .from("quote_items")
      .select("description, line_total_inc_gst, sort, code")
      .eq("quote_id", quoteId),
    admin
      .from("customer_estimate_links")
      .select("token,status,expires_at")
      .eq("job_id", jobId)
      .eq("purpose", "step3_estimate")
      .eq("status", "active")
      .maybeSingle(),
    propertyId
      ? admin
          .from("properties")
          .select("address_line, suburb, postcode")
          .eq("id", propertyId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const { linkUsable } = await import("./estimatelink.core");
  if (
    qe ||
    le ||
    !quote ||
    quote.customer_total_inc_gst == null ||
    !Number.isFinite(Number(quote.customer_total_inc_gst))
  )
    return { input: null, missing: "quote total unavailable" };
  if (!link || !linkUsable(link)) return { input: null, missing: "owner secure link missing" };
  const { CUSTOMER_BASE } = await import("./engagement.core");
  const { fullAddress } = await import("./address");
  const { firstName } = await import("./worker-links.core");
  const { quoteExpiresAt, quoteValidDaysFor } = await import("./quote-expiry.core");
  const { lastValidInstant, safetyCheckPriceFromLines } = await import("./owner-quote-email.core");
  // Lines/address are best-effort presentation: a failed read shows fewer details, never a wrong number.
  const lines = ie
    ? []
    : [...(items ?? [])]
        .sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0))
        .map((l) => ({
          description: String(l.description ?? ""),
          lineTotalIncGst: Number(l.line_total_inc_gst),
          // Part 10 Task 5: own customers' rows are built from the code, never the description.
          code: (l as { code?: string | null }).code ?? null,
        }));
  const address =
    pe || !prop ? null : fullAddress(prop.address_line, prop.suburb, prop.postcode) || null;
  // Jo 24 Oct: what the owner is getting — area, removal, product and the (approved, so EEC-certified) installer.
  // Best-effort like the lines above: a failed read leaves a detail out, never stops the email.
  const extra = await (async () =>
    Promise.all([
      admin
        .from("ceiling_measurements")
        .select("measured_area_m2, verified_area_m2, removal_required, removal_m2, insulation_present, zones")
        .eq("job_id", jobId)
        .eq("is_current", true)
        .maybeSingle(),
      admin
        .from("workflow_events")
        .select("details")
        .eq("job_id", jobId)
        .eq("event_type", "mitti_product_recorded")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from("job_assignments")
        .select("businesses(name, trading_name, onboarding_status, is_active)")
        .eq("job_id", jobId)
        .eq("role", "installer")
        .eq("active", true)
        .limit(1)
        .maybeSingle(),
      // Decision #29: the estimate side of "What's changed" — the saved estimate (as the Ready Check booked email reads it).
      admin
        .from("lead_campaign_responses")
        .select("saved_total, saved_area_m2")
        .eq("job_id", jobId)
        .maybeSingle()
        .then((r) => r, () => ({ data: null, error: null })),
    ]))().catch(() => [{ data: null }, { data: null }, { data: null }, { data: null }] as const);
  const [{ data: m }, { data: prod }, { data: asg }, savedRead] = extra as unknown as [
    {
      data: {
        measured_area_m2: unknown;
        verified_area_m2: unknown;
        removal_required: boolean | null;
        removal_m2: unknown;
        insulation_present?: boolean | null;
        zones?: unknown;
      } | null;
    },
    { data: { details: unknown } | null },
    { data: { businesses: unknown } | null },
    { data: { saved_total: unknown; saved_area_m2: unknown } | null } | undefined,
  ];
  const saved = savedRead?.data ?? null;
  const biz = (asg?.businesses ?? null) as {
    name: string | null;
    trading_name: string | null;
    onboarding_status: string | null;
    is_active: boolean | null;
  } | null;
  const area = m ? Number(m.verified_area_m2 ?? m.measured_area_m2) || null : null;
  const { quoteChangeRows } = await import("./quote-changes.core");
  const savedNum = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));
  // No removal answer is recorded with the saved estimate, so that row only shows once one is (never guessed).
  const changes = area == null ? [] : quoteChangeRows({
    estimate: { areaM2: savedNum(saved?.saved_area_m2), removal: null, price: savedNum(saved?.saved_total) },
    quote: { areaM2: area, removal: m?.removal_required === true, price: Number(quote.customer_total_inc_gst) },
  });
  const product =
    (prod?.details as { product?: { option?: string } } | null)?.product?.option ?? null;
  // Part 10 Task 5: an installer's own customer gets the co-branded variant — the originating business's name and Part 5's
  // https logo (`businessLogoUrl`; none → our logo alone). Best-effort: a failed read leaves the brand out, never stops the email.
  const ownCustomer = await ownCustomerBrand(jobId).catch(() => null);
  // Jo 4 Nov 2026 16:10: the old insulation stays (Ready Check: not removed + good enough to lay over) → the approved notice
  // on the quote email / page and in the agreement. Only when recorded (kept-insulation.core); the read failing = no notice.
  const keptInsulation = (await import("./kept-insulation.core")).oldInsulationKept(m);
  return {
    missing: null,
    input: {
      ...(ownCustomer ? { ownCustomer } : {}),
      ...(keptInsulation ? { keptInsulation } : {}),
      firstName: firstName(ownerName),
      address,
      totalIncGst: Number(quote.customer_total_inc_gst),
      rebateIncGst:
        quote.veec_discount_inc_gst == null ? null : Number(quote.veec_discount_inc_gst),
      lines,
      quoteUrl: `${CUSTOMER_BASE}/my-job/${link.token}?screen=quote&quote=${quoteId}`,
      validUntil:
        quote.kind === "installation" && quote.sent_at
          ? lastValidInstant(quoteExpiresAt(quote.sent_at))
          : null,
      // Decision #30: 30-day quotes get the "valid for 30 days, until" wording in the reminders; older quotes keep 14 days.
      ...(quote.kind === "installation" && quote.sent_at ? { validDays: quoteValidDaysFor(quote.sent_at) } : {}),
      officePhone: null,
      safetyCheckPrice: safetyCheckPriceFromLines(lines),
      subtotalIncGst: quote.subtotal_inc_gst == null ? null : Number(quote.subtotal_inc_gst),
      areaM2: area,
      removalM2: m?.removal_required ? Number(m.removal_m2) || null : null,
      product,
      installerName: biz?.trading_name ?? biz?.name ?? null,
      installerCertified: biz?.onboarding_status === "approved" && biz.is_active === true,
      changes,
    },
  };
}

/** Part 10 Task 5: `{ installerName, installerLogoUrl }` for a `channel = installer_sourced` job, else null. */
async function ownCustomerBrand(jobId: string): Promise<{ installerName: string; installerLogoUrl: string | null } | null> {
  const { data: j } = await admin.from("jobs").select("channel, originating_installer_business_id").eq("id", jobId).maybeSingle();
  const biz = (j as { channel?: string | null; originating_installer_business_id?: string | null } | null);
  if (biz?.channel !== "installer_sourced" || !biz.originating_installer_business_id) return null;
  const { data: b } = await admin.from("businesses").select("name, trading_name").eq("id", biz.originating_installer_business_id).maybeSingle();
  const name = ((b as { trading_name?: string | null; name?: string | null } | null)?.trading_name ?? (b as { name?: string | null } | null)?.name ?? "").trim();
  if (!name) return null;
  const installerLogoUrl = await (await import("./trade-view.server")).businessLogoUrl(biz.originating_installer_business_id).catch(() => null);
  return { installerName: name, installerLogoUrl };
}

type QuoteEmailInput = NonNullable<OwnerQuoteFacts["input"]>;
type EmailAttachment = import("./email-kit.core").EmailAttachment;

/** Decision #33: the documents attached to the v4 quote email — Customer Agreement + payment terms (one PDF, the approved
 *  v1.3 layout) and the ESC Statement of rights. `missing` names what isn't ready; the caller then never sends v4. */
export async function quoteEmailDocuments(
  jobId: string,
  quoteId: string,
  input: QuoteEmailInput,
  ownerName: string | null,
  jobNumber: string | null,
): Promise<{ attachments: EmailAttachment[]; missing: null } | { attachments: null; missing: string }> {
  const no = (missing: string) => ({ attachments: null, missing });
  try {
    // The agreement states "valid for 30 days, until {date}", so it only goes with a 30-day quote.
    if (input.validDays !== 30) return no("not a 30-day quote");
    const [{ activeCustomerAgreement }, { businessContactForJob }, { statementOfRightsPdf, STATEMENT_OF_RIGHTS_FILENAME }] = await Promise.all([
      import("./customer-agreement.server"), import("./owner-contact.server"), import("./statement-of-rights.core"),
    ]);
    const [tpl, installer, { data: items, error: ie }] = await Promise.all([
      activeCustomerAgreement(),
      businessContactForJob(jobId, "installer"),
      admin.from("quote_items").select("code, line_total_inc_gst").eq("quote_id", quoteId),
    ]);
    if (!tpl) return no("Customer Agreement wording not active");
    if (ie) return no("quote lines unavailable");
    const { safetyCheckCentsFor } = await import("./safety-check-amount.core");
    const { quoteAgreementFacts } = await import("./owner-quote-email.core");
    const facts = quoteAgreementFacts({
      input, ownerName, jobNumber, installer,
      safetyCents: safetyCheckCentsFor({ lines: (items ?? []) as { code: string | null; line_total_inc_gst: number | null }[] }).cents,
    });
    if (!facts) return no(installer?.officePhone && installer.email ? "agreement details missing" : "installer office phone or business email missing");
    const { agreementBlocks, customerAgreementPdf, PAYMENT_TERMS_BLOCK_ID } = await import("./customer-agreement-pdf.server");
    if (!agreementBlocks(tpl, facts, { keptInsulation: input.keptInsulation === true }).some((b) => (b as { id?: string }).id === PAYMENT_TERMS_BLOCK_ID)) return no("payment terms missing from the Customer Agreement");
    const sor = statementOfRightsPdf();
    if (!sor) return no("Statement of rights not on file");
    const agreement = await customerAgreementPdf(tpl, facts, { keptInsulation: input.keptInsulation === true });
    const { bytesToBase64 } = await import("./veec-emails.core");
    const pdf = (filename: string, bytes: Uint8Array): EmailAttachment => ({ filename, content: bytesToBase64(bytes), contentType: "application/pdf" });
    return { attachments: [pdf(agreement.fileName, agreement.bytes), pdf(STATEMENT_OF_RIGHTS_FILENAME, sor)], missing: null };
  } catch (e) {
    return no(e instanceof Error ? e.message : "documents could not be made");
  }
}

/** The quote text is still worth sending only while that quote is issued and released (decision 165; batch 2 7am send). */
export const quoteStillReleased = (
  q: { status?: string | null; release_state?: string | null } | null | undefined,
) => q?.status === "issued" && q?.release_state === "released";

/** Key ending for this quote's quote-ready text and email: none for the first send, `:r${n}` after the n-th office reopen of
 *  the declined quote, so a re-sent quote is a new send. Shared by the sender and the 7am held-text sweep. Throws if unreadable. */
export async function currentQuoteReadyKeySuffix(jobId: string, quoteId: string): Promise<string> {
  const { data, error } = await admin
    .from("workflow_events")
    .select("id")
    .eq("job_id", jobId)
    .eq("event_type", "quote_reopened_by_office")
    .contains("details", { quote_id: quoteId });
  if (error) throw new Error(`Quote reopen count could not be read: ${error.message}`);
  const n = (data ?? []).length;
  return n > 0 ? `:r${n}` : "";
}

export async function notifyOwnerQuoteReady(
  jobId: string,
  quoteId: string,
  kind: string,
): Promise<QuoteNotifyResult> {
  if (kind !== "installation") return { sms: "skipped", email: "skipped" };
  const { assertCustomerDeliveryAllowed } = await import("./comms.server");
  await assertCustomerDeliveryAllowed(jobId, "Office quote notification");
  const { data: job } = await admin
    .from("jobs")
    .select("owner_id, property_id, job_number, source, stage, deleted_at, qa_archived_at, channel")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { sms: "skipped", email: "skipped" };
  if ((await import("./mitti.core")).isClosedOrArchivedJob(job))
    return { sms: "skipped", email: "skipped" };
  const { data: owner } = await admin
    .from("owners")
    .select("phone, email, full_name")
    .eq("id", job.owner_id)
    .maybeSingle();
  const { renderOwnerQuoteEmail, ownerQuoteSms, OWNER_QUOTE_EMAIL_APPROVED, OWNER_QUOTE_EMAIL_V4_APPROVED, QUOTE_DOCUMENTS_HELD } =
    await import("./owner-quote-email.core");
  const ownMessages = await import('./own-customer-messages.server');
  const replacement = job.channel === 'installer_sourced' ? await ownMessages.ownQuoteReplacement(jobId, quoteId) : null;
  const ownEmailApproved = job.channel !== 'installer_sourced' || await ownMessages.approvedOwnMessage(replacement ? 'own_owner_updated_quote' : 'own_owner_quote');
  // New wording holds apply to TEST delivery too; existing quote text/reminders are untouched.
  const officeNumber = replacement ? (await import('./completion-emails.core')).HIV_AP_CONTACT.officePhone?.trim() || null : null;
  const ownEmailHeld = !ownEmailApproved ? 'held — awaiting wording approval' : replacement && !officeNumber ? 'held — office number required for updated quote email' : null;
  let readyCheckVisit = false;
  if (job.channel === 'installer_sourced' && ownEmailApproved && !replacement) {
    const { count, error } = await admin.from('bookings').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('kind', 'ready_check').in('status', ['confirmed', 'completed']);
    if (error || count == null) throw new Error('Ready Check visit could not be checked; quote email held.');
    readyCheckVisit = count > 0;
  }
  const { renderOwnCustomerQuoteEmail: renderOwnCustomerQuoteEmailChecked, renderOwnCustomerUpdatedQuoteEmail } = await import('./own-customer-quote-messages.core');
  const date = (iso: string) => new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', day: 'numeric', month: 'short' }).format(new Date(iso));
  const renderQuote = (input: import('./owner-quote-email.core').OwnerQuoteEmailInput) => {
    if (job.channel !== 'installer_sourced') return renderOwnerQuoteEmail(input);
    if (replacement) {
      if (!officeNumber || !input.validUntil || !input.ownCustomer?.installerName) throw new Error('Updated quote email details unavailable.');
      return renderOwnCustomerUpdatedQuoteEmail({ firstName: input.firstName || 'there', installer: input.ownCustomer.installerName, address: input.address || job.job_number, link: input.quoteUrl, previousSentDate: date(replacement.previousSentAt), validUntil: date(input.validUntil.toISOString()), officeNumber, unsubscribeUrl: input.unsubscribeUrl, test: input.test === true });
    }
    return renderOwnCustomerQuoteEmailChecked({ ...input, readyCheckVisit });
  };

  if (job.source === "qa_test") {
    // Partner verification and quote facts are independent reads. Keep partner
    // refusal first, and keep unsubscribe preparation and both sends sequential.
    const [partnerRead, factsRead] = await Promise.all([
      (async () => {
        const { data: assigned, error: ae } = await admin
          .from("job_assignments")
          .select("business_id")
          .eq("job_id", jobId)
          .eq("role", "installer")
          .eq("active", true)
          .maybeSingle();
        const { data: partner, error: pe } = assigned?.business_id
          ? await admin
              .from("businesses")
              .select("onboarding_notes")
              .eq("id", assigned.business_id)
              .maybeSingle()
          : { data: null, error: null };
        if (ae || pe) throw new Error("TEST partner could not be checked.");
        return partner;
      })().then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
      loadOwnerQuoteFacts(jobId, quoteId, owner?.full_name ?? null, job.property_id ?? null).then(
        (value) => ({ ok: true as const, value }),
        (error) => ({ ok: false as const, error }),
      ),
    ]);
    if (!partnerRead.ok) throw partnerRead.error;
    if (!factsRead.ok) throw factsRead.error;
    const partner = partnerRead.value;
    const facts = factsRead.value;
    const { isTestPartner } = await import("./test-send.core");
    const { sendTestEmail, sendTestSms } = await import("./test-send.server");
    if (!facts.input) throw new Error("TEST quote total or owner link is unavailable.");
    // TEST may show the draft wording regardless of approval; the unsubscribe link is best-effort here.
    const unsubscribe = await (
      await import("./emailsafety.server")
    )
      .unsubscribeUrlForJob(jobId)
      .catch(() => null);
    // TEST previews the v4 draft (decision #29) with whatever documents are ready; it is never held.
    const docs = await quoteEmailDocuments(jobId, quoteId, facts.input, owner?.full_name ?? null, job.job_number ?? null);
    const mail = ownEmailHeld ? null : renderQuote({ ...facts.input, v4: true, unsubscribeUrl: unsubscribe, test: true });
    const ctx = {
      jobId,
      jobSource: job.source,
      partnerIsTest: isTestPartner(partner),
      label: `quote_ready:${quoteId}`,
      actorId: null,
    };
    const email = mail ? await sendTestEmail(ctx, owner?.email ?? "", mail.subject, mail.html, mail.text, docs.attachments ? { attachments: docs.attachments } : {}) : { status: 'held', detail: ownEmailHeld };
    const sms = await sendTestSms(
      ctx,
      owner?.phone ?? "",
      ownerQuoteSms(facts.input.firstName, facts.input.quoteUrl),
    );
    return { email: `${email.status}: ${email.detail}`, sms: `${sms.status}: ${sms.detail}` };
  }

  const { sendRealSms } = await import("./sms.server");
  // The release-state and reopen-key reads do not depend on one another.
  // Capture the key error so its existing refusal still precedes quote facts/sends.
  const [suffix, { data: q }] = await Promise.all([
    currentQuoteReadyKeySuffix(jobId, quoteId).then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    ),
    admin
      .from("quotes")
      .select("sent_at, status, release_state")
      .eq("id", quoteId)
      .eq("job_id", jobId)
      .maybeSingle(),
  ]);
  if (!suffix.ok)
    return {
      sms: `failed: ${suffix.error instanceof Error ? suffix.error.message : "error"}`,
      email: "not sent — quote reopen count unavailable",
    };
  const keySuffix = suffix.value;
  // Decision 165: the trigger is the quote release (sent_at). A switch flipped on days later must not text an old
  // release, and never one that has since been accepted/declined/reopened — so the sender gets the release time and state.
  // The approved text (decision 87) carries the secure My job link, so the same facts the email uses are read first.
  const loaded = await loadOwnerQuoteFacts(
    jobId,
    quoteId,
    owner?.full_name ?? null,
    job.property_id ?? null,
  );
  const s = loaded.input
    ? await sendRealSms({
        type: "quote_ready",
        idempotencyKey: `quote-ready:v1:${quoteId}${keySuffix}`,
        to: owner?.phone ?? null,
        jobId,
        body: ownerQuoteSms(loaded.input.firstName, loaded.input.quoteUrl),
        event: { at: q?.sent_at ?? null, current: quoteStillReleased(q) },
      }).catch((e) => ({
        status: "failed" as const,
        detail: e instanceof Error ? e.message : "error",
        sid: null,
      }))
    : { status: "blocked" as const, detail: `not sent — ${loaded.missing}`, sid: null };

  // Approved rendered email wins; until Jo approves it only an approved DB template may be sent.
  const facts = OWNER_QUOTE_EMAIL_APPROVED ? loaded : null;
  const { data: tpl } = OWNER_QUOTE_EMAIL_APPROVED
    ? { data: null }
    : await admin
        .from("customer_communication_templates")
        .select("subject, body_markdown")
        .eq("template_key", QUOTE_EMAIL_TEMPLATE_KEY)
        .eq("status", "approved")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
  const wording = OWNER_QUOTE_EMAIL_APPROVED
    ? facts?.input
      ? "rendered"
      : null
    : tpl
      ? "template"
      : null;
  let email = OWNER_QUOTE_EMAIL_APPROVED
    ? `not sent — ${facts?.missing ?? "quote details unavailable"}`
    : "no approved wording — not sent";
  // Decision #29/#33: v4 (flag on, 30-day quotes) goes only with its documents; otherwise it is held for the office.
  const v4 = wording === "rendered" && OWNER_QUOTE_EMAIL_V4_APPROVED && facts?.input?.validDays === 30;
  const docs = v4 && facts?.input && owner?.email
    ? await quoteEmailDocuments(jobId, quoteId, facts.input, owner.full_name ?? null, job.job_number ?? null)
    : null;
  if (ownEmailHeld) {
    email = ownEmailHeld;
  } else if (docs?.missing) {
    email = `held — ${QUOTE_DOCUMENTS_HELD} (${docs.missing})`;
    await logEvent(
      jobId,
      null,
      "ready_check_needs_office",
      `Quote released to the owner — ${QUOTE_DOCUMENTS_HELD} (${docs.missing}), so the quote email is held`,
      { quote_id: quoteId, needs_office: true, reason: "quote_documents_not_ready", missing: docs.missing },
      { internal: true },
    );
  } else if (wording && owner?.email) {
    email = await (
      await import("./owner-email-send.server")
    ).sendGuardedOwnerEmail({
      jobId,
      jobSource: job.source,
      to: owner.email,
      purpose: "quote_ready",
      key: `quote-ready-email:v1:${quoteId}${keySuffix}`,
      build: (unsubscribe) => {
        if (wording === "rendered" && facts?.input) {
          if (v4 && docs?.attachments) return { ...renderQuote({ ...facts.input, v4: true, unsubscribeUrl: unsubscribe, test: false }), attachments: docs.attachments };
          return renderQuote({ ...facts.input, v4: false, unsubscribeUrl: unsubscribe, test: false });
        }
        if (!tpl) throw new Error('Approved quote wording unavailable');
        return { subject: tpl.subject, html: genericMail({subject:tpl.subject,bodyHtml:tpl.body_markdown,unsubscribe}), text: tpl.body_markdown };
      },
    });
  }
  if (OWNER_QUOTE_EMAIL_APPROVED && !facts?.input) {
    const linkMissing = facts?.missing === "owner secure link missing";
    await logEvent(
      jobId,
      null,
      "ready_check_needs_office",
      linkMissing
        ? "Quote released to the owner — the owner has no working secure My job link, so no quote email or text was sent"
        : "Quote released to the owner — the quote total could not be read, so no quote email or text was sent",
      {
        quote_id: quoteId,
        needs_office: true,
        reason: linkMissing ? "owner_link_missing" : "quote_total_unavailable",
      },
      { internal: true },
    );
  }
  if (!OWNER_QUOTE_EMAIL_APPROVED && !tpl) {
    await logEvent(
      jobId,
      null,
      "ready_check_needs_office",
      "Quote released to the owner — no approved quote email wording on file, so no email was sent",
      { quote_id: quoteId, needs_office: true },
      { internal: true },
    );
  }
  return { sms: `${s.status}: ${s.detail}`, email };
}
