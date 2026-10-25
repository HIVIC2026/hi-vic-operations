// Server functions for the approved owner emails whose workflow step is still being built (decision 137: designs applied,
// nothing sent). Each one renders the approved design and goes through `sendOwnerTemplateEmail`, so a real owner can only
// receive it once its *_APPROVED flag is true and customer messages are on; TEST jobs get it through test-send now.
// Only `emailOwnerInstallComplete` is called from a workflow (the VEEC day-0 request); Office/QA may call the rest for TEST jobs.
import { sendOwnerTemplateEmail } from "./owner-template-send.server";

export async function emailOwnerQuoteReminder(jobId: string, quoteId: string, kind: "day3" | "expiry", quote: Omit<import("./owner-quote-email.core").OwnerQuoteEmailInput, "firstName" | "unsubscribeUrl" | "test">) {
  const { QUOTE_REMINDER_EMAIL_APPROVED, renderQuoteReminderEmail } = await import("./owner-quote-email.core");
  return sendOwnerTemplateEmail({ jobId, purpose: "quote_reminder", key: `quote-reminder:v1:${quoteId}:${kind}`, approved: QUOTE_REMINDER_EMAIL_APPROVED, label: "Quote reminder", notSentEvent: "quote_reminder_email_not_sent",
    render: (f) => renderQuoteReminderEmail({ ...quote, kind, firstName: f.firstName, unsubscribeUrl: null, test: f.test }) });
}

export async function emailOwnerYoureIn(jobId: string, quoteId: string, i: Omit<import("./acceptance-email.core").AcceptanceEmailInput, "firstName" | "installerName" | "myJobUrl" | "test" | "factsheetAttached">) {
  const { ACCEPTANCE_EMAIL_APPROVED, renderYoureInEmail } = await import("./acceptance-email.core");
  // Decision 320: the ESC VEU consumer factsheet goes with O22 when it is on file; recorded on the job only after a real send.
  const { factsheetAttachment, recordFactsheetGiven } = await import("./veu-factsheet.server");
  const fs = factsheetAttachment();
  const r = await sendOwnerTemplateEmail({ jobId, purpose: "quote_accepted", key: `youre-in:v1:${quoteId}`, approved: ACCEPTANCE_EMAIL_APPROVED, label: "You're in email", notSentEvent: "youre_in_email_not_sent", ...(fs.attachment ? { attachments: [fs.attachment] } : {}),
    render: (f) => renderYoureInEmail({ ...i, firstName: f.firstName, installerName: f.installerName, myJobUrl: f.myJobUrl, test: f.test, factsheetAttached: !!fs.attachment }) });
  const { ownerEmailSent } = await import("./completion-pack.core");
  await recordFactsheetGiven(jobId, { sent: ownerEmailSent(r), attached: !!fs.attachment, via: "You're in email (O22)", result: r });
  return r;
}

export async function emailOwnerSafetyCheckTimes(jobId: string, startsAt: string[], electricianName: string | null, paid: number | null) {
  const { SAFETY_CHECK_EMAILS_APPROVED, renderSafetyCheckTimesEmail } = await import("./safety-check-emails.core");
  const { formatReadyCheckTime } = await import("./ready-check-times.core");
  const key = [...startsAt].sort().join(",");
  return sendOwnerTemplateEmail({ jobId, purpose: "safety_check_times", key: `safety-check-times:v1:${jobId}:${key}`, approved: SAFETY_CHECK_EMAILS_APPROVED, label: "Safety check times email", notSentEvent: "safety_check_times_email_not_sent",
    render: (f) => renderSafetyCheckTimesEmail({ firstName: f.firstName, electricianName, times: [...startsAt].sort().map((s) => formatReadyCheckTime(s)), myJobUrl: f.myJobUrl, paid, test: f.test }) });
}

export async function emailOwnerSafetyCheckBooked(jobId: string, startIso: string, electrician: { name: string | null; phone?: string | null }, changed: boolean) {
  const { SAFETY_CHECK_EMAILS_APPROVED, renderSafetyCheckBookedEmail } = await import("./safety-check-emails.core");
  const { formatReadyCheckTime } = await import("./ready-check-times.core");
  return sendOwnerTemplateEmail({ jobId, purpose: "safety_check_booked", key: `safety-check-booked:v1:${jobId}:${startIso}`, approved: SAFETY_CHECK_EMAILS_APPROVED, label: "Safety check booked email", notSentEvent: "safety_check_booked_email_not_sent",
    render: (f) => renderSafetyCheckBookedEmail({ firstName: f.firstName, when: formatReadyCheckTime(startIso), electricianName: electrician.name, electricianPhone: electrician.phone ?? null, address: f.address, changed, myJobUrl: f.myJobUrl, test: f.test }) });
}

export async function emailOwnerFixesQuote(jobId: string, quoteId: string, i: Omit<import("./rectification-quote-email.core").FixesQuoteEmailInput, "firstName" | "approveUrl" | "test">) {
  const { FIXES_QUOTE_EMAIL_APPROVED, renderFixesQuoteEmail } = await import("./rectification-quote-email.core");
  return sendOwnerTemplateEmail({ jobId, purpose: "fixes_quote", key: `fixes-quote:v1:${quoteId}`, approved: FIXES_QUOTE_EMAIL_APPROVED, label: "Electrical fixes quote email", notSentEvent: "fixes_quote_email_not_sent",
    render: (f) => renderFixesQuoteEmail({ ...i, firstName: f.firstName, approveUrl: `${f.myJobUrl}?screen=quote`, test: f.test }) });
}

export async function emailOwnerInstallDays(jobId: string, startsAt: string[], balanceIncGst: number | null, installBy: string | null) {
  const { INSTALL_DAYS_EMAIL_APPROVED, renderInstallDaysEmail } = await import("./install-days-email.core");
  const { formatInstallDay } = await import("./install-days.core");
  const key = [...startsAt].sort().join(",");
  return sendOwnerTemplateEmail({ jobId, purpose: "install_days", key: `install-days:v1:${jobId}:${key}`, approved: INSTALL_DAYS_EMAIL_APPROVED, label: "Install days email", notSentEvent: "install_days_email_not_sent",
    render: (f) => renderInstallDaysEmail({ firstName: f.firstName, installerName: f.installerName, days: [...startsAt].sort().map((s) => formatInstallDay(s)), myJobUrl: f.myJobUrl, balanceIncGst, installBy, test: f.test }) });
}

export async function emailOwnerInstallDayChanged(jobId: string, startIso: string, wasIso: string) {
  const { INSTALL_DAYS_EMAIL_APPROVED, renderInstallDayChangedEmail } = await import("./install-days-email.core");
  const { formatInstallDay } = await import("./install-days.core");
  return sendOwnerTemplateEmail({ jobId, purpose: "install_day_changed", key: `install-day-changed:v1:${jobId}:${startIso}`, approved: INSTALL_DAYS_EMAIL_APPROVED, label: "Install day changed email", notSentEvent: "install_day_changed_email_not_sent",
    render: (f) => renderInstallDayChangedEmail({ firstName: f.firstName, installerName: f.installerName, installerPhone: f.installerPhone, address: f.address, when: formatInstallDay(startIso), was: formatInstallDay(wasIso), myJobUrl: f.myJobUrl, test: f.test }) });
}

export async function emailOwnerInstallComplete(jobId: string, i: Omit<import("./completion-emails.core").InstallCompleteInput, "firstName" | "installer" | "test" | "attachedWarranties">) {
  // Decision 169: this is the day-0 VEEC signing request (one per job by key), sent from veec-reminders.server.ts.
  const { INSTALL_COMPLETE_EMAIL_APPROVED, renderInstallCompleteEmail } = await import("./completion-emails.core");
  // Decision 321: the manufacturer warranty PDF(s) for the installed product(s) go with this email, and
  // `warranty_copy_provided` is recorded after a confirmed send (no longer waiting for full payment). Missing PDF: send
  // anyway, record nothing (the AP signature holds with "Warranty copy for <product> not on file").
  const pw = await import("./product-warranty.server");
  let decision: Awaited<ReturnType<typeof pw.warrantyDecisionFor>> | null = null;
  let copies: Awaited<ReturnType<typeof pw.prepareWarrantyCopies>> = { attachments: [], attached: [], missing: [] };
  try { decision = await pw.warrantyDecisionFor(jobId); copies = await pw.prepareWarrantyCopies(jobId, null, decision); }
  catch (e) { console.error("All done email: warranty copy skipped", jobId, (e as Error).message); }
  const attachedNames = copies.attached.map((w) => w.productName);
  const r = await sendOwnerTemplateEmail({ jobId, purpose: "install_complete", key: `install-complete:v1:${jobId}`, approved: INSTALL_COMPLETE_EMAIL_APPROVED, label: "Install complete email", notSentEvent: "install_complete_email_not_sent", ...(copies.attachments.length ? { attachments: copies.attachments } : {}),
    render: (f) => renderInstallCompleteEmail({ ...i, firstName: f.firstName, installer: { name: f.installerName, phone: f.installerPhone }, attachedWarranties: attachedNames, test: f.test }) });
  if (decision) {
    const { recordWarrantyCopyProvided } = await import("./completion-pack.server");
    await recordWarrantyCopyProvided(jobId, null, { via: "all_done_email", result: r, decision, attached: copies.attached, missing: copies.missing }).catch((e: Error) => console.error("All done email: warranty record skipped", jobId, e.message));
  }
  return r;
}

/** Decision 209: the installed product line (brand, model, R-value, m², ESC model codes when known) read from the job; null when unknown. */
async function installedLineFor(jobId: string, given: import("./completion-emails.core").InstalledLine | null | undefined) {
  if (given !== undefined) return given;
  const { installedProductLine } = await import("./invoice-itemisation.server");
  const line = await installedProductLine(jobId);
  return line ? { description: line.description, escModelCodes: line.escModelCodes } : null;
}

export async function emailOwnerFinalInvoice(jobId: string, i: Omit<import("./completion-emails.core").FinalInvoiceInput, "firstName" | "ownerName" | "address" | "installer" | "test">) {
  const { COMPLETION_EMAILS_APPROVED, renderFinalInvoiceEmail } = await import("./completion-emails.core");
  const installed = await installedLineFor(jobId, i.installed);
  return sendOwnerTemplateEmail({ jobId, purpose: "final_invoice", key: `final-invoice:v1:${i.invoiceNumber}`, approved: COMPLETION_EMAILS_APPROVED, label: "Final invoice email", notSentEvent: "final_invoice_email_not_sent",
    render: (f) => renderFinalInvoiceEmail({ ...i, installed, firstName: f.firstName, ownerName: f.ownerName, address: f.address, installer: { name: f.installerName, phone: f.installerPhone }, test: f.test }) });
}

/** Workflow caller: completion-pack.server.ts (install complete + invoice paid), which passes the manufacturer warranty PDF(s) for the installed product(s). */
export async function emailOwnerCompletionPack(jobId: string, downloads: import("./completion-emails.core").CompletionPackInput["downloads"], installedGiven?: import("./completion-emails.core").InstalledLine | null,
  extras: { attachments?: import("./email-kit.core").EmailAttachment[]; attachedWarranties?: string[]; attachedCoes?: boolean } = {}) {
  const { COMPLETION_EMAILS_APPROVED, renderCompletionPackEmail } = await import("./completion-emails.core");
  const installed = await installedLineFor(jobId, installedGiven);
  return sendOwnerTemplateEmail({ jobId, purpose: "completion_pack", key: `completion-pack:v1:${jobId}`, approved: COMPLETION_EMAILS_APPROVED, label: "Completion pack email", notSentEvent: "completion_pack_email_not_sent", ...(extras.attachments?.length ? { attachments: extras.attachments } : {}),
    render: (f) => renderCompletionPackEmail({ firstName: f.firstName, installer: { name: f.installerName, phone: f.installerPhone }, downloads, installed, attachedWarranties: extras.attachedWarranties ?? [], attachedCoes: extras.attachedCoes === true, test: f.test }) });
}

export async function emailOwnerReviewRequest(jobId: string, i: { googleReviewUrl: string; referralUrl: string }) {
  const { COMPLETION_EMAILS_APPROVED, renderReviewRequestEmail } = await import("./completion-emails.core");
  return sendOwnerTemplateEmail({ jobId, purpose: "review_request", key: `review-request:v1:${jobId}`, approved: COMPLETION_EMAILS_APPROVED, label: "Review request email", notSentEvent: "review_request_email_not_sent",
    render: (f) => renderReviewRequestEmail({ firstName: f.firstName, installer: { name: f.installerName, phone: f.installerPhone }, starUrl: (n) => `${f.myJobUrl}?screen=review&stars=${n}`, googleReviewUrl: i.googleReviewUrl, referralUrl: i.referralUrl, test: f.test }) });
}
