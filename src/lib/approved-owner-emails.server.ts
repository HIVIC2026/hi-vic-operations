// Server functions for the approved owner emails whose workflow step is still being built (decision 137: designs applied,
// nothing sent). Each one renders the approved design and goes through `sendOwnerTemplateEmail`, so a real owner can only
// receive it once its *_APPROVED flag is true and customer messages are on; TEST jobs get it through test-send now.
// Workflow callers: `emailOwnerInstallComplete` (VEEC day-0 request), `emailOwnerCompletionPack` (completion-pack.server.ts) and,
// since decision 325, owner-email-triggers.server.ts for O19/O22/O42/O51. Retired 2 Nov 2026 (Part 4 Task 14): O26 pick a
// time / safety check booked, O29 fixes quote, O33 pick your install day and the O45 final invoice (the All done email
// carries the tax invoice and balance).
import { sendOwnerTemplateEmail } from "./owner-template-send.server";
import { ownerEmailKey } from "./owner-email-triggers.core";
import { COMPLETION_PACK_EMAIL_KEY } from "./completion-pack.core";

export async function emailOwnerQuoteReminder(jobId: string, quoteId: string, kind: "day3" | "expiry", quote: Omit<import("./owner-quote-email.core").OwnerQuoteEmailInput, "firstName" | "unsubscribeUrl" | "test">) {
  const { QUOTE_REMINDER_EMAIL_APPROVED, renderQuoteReminderEmail } = await import("./owner-quote-email.core");
  return sendOwnerTemplateEmail({ jobId, purpose: "quote_reminder", key: ownerEmailKey.quoteReminder(quoteId, kind), approved: QUOTE_REMINDER_EMAIL_APPROVED, label: "Quote reminder", notSentEvent: "quote_reminder_email_not_sent",
    render: (f) => renderQuoteReminderEmail({ ...quote, kind, firstName: f.firstName, unsubscribeUrl: f.unsubscribeUrl ?? null, test: f.test }) });
}

export async function emailOwnerYoureIn(jobId: string, quoteId: string, i: Omit<import("./acceptance-email.core").AcceptanceEmailInput, "firstName" | "installerName" | "myJobUrl" | "test" | "factsheetAttached">, attachments: import("./email-kit.core").EmailAttachment[] = []) {
  const { ACCEPTANCE_EMAIL_APPROVED, renderYoureInEmail } = await import("./acceptance-email.core");
  // Decision 320: the ESC VEU consumer factsheet goes with O22 when it is on file; recorded on the job only after a real send.
  const { factsheetAttachment, recordFactsheetGiven } = await import("./veu-factsheet.server");
  const fs = factsheetAttachment();
  const all = [...attachments, ...(fs.attachment ? [fs.attachment] : [])];
  const r = await sendOwnerTemplateEmail({ jobId, purpose: "quote_accepted", key: ownerEmailKey.youreIn(quoteId), approved: ACCEPTANCE_EMAIL_APPROVED, label: "You're in email", notSentEvent: "youre_in_email_not_sent", ...(all.length ? { attachments: all } : {}),
    render: (f) => renderYoureInEmail({ ...i, firstName: f.firstName, installerName: f.installerName, myJobUrl: f.myJobUrl, test: f.test, factsheetAttached: !!fs.attachment }) });
  const { ownerEmailSent } = await import("./completion-pack.core");
  await recordFactsheetGiven(jobId, { sent: ownerEmailSent(r), attached: !!fs.attachment, via: "You're in email (O22)", result: r });
  return r;
}

export async function emailOwnerInstallDayChanged(jobId: string, startIso: string, wasIso: string) {
  const { INSTALL_DAYS_EMAIL_APPROVED, renderInstallDayChangedEmail } = await import("./install-days-email.core");
  const { formatInstallDay } = await import("./install-days.core");
  return sendOwnerTemplateEmail({ jobId, purpose: "install_day_changed", key: ownerEmailKey.installDayChanged(jobId, startIso), approved: INSTALL_DAYS_EMAIL_APPROVED, label: "Install day changed email", notSentEvent: "install_day_changed_email_not_sent",
    render: (f) => renderInstallDayChangedEmail({ firstName: f.firstName, installerName: f.installerName, installerPhone: f.installerPhone, address: f.address, when: formatInstallDay(startIso), was: formatInstallDay(wasIso), myJobUrl: f.myJobUrl, test: f.test }) });
}

export async function emailOwnerInstallComplete(jobId: string, i: Omit<import("./completion-emails.core").InstallCompleteInput, "firstName" | "installer" | "test" | "attachedWarranties" | "signAndPayUrl" | "contacts" | "attached">, opts: { v2?: boolean } = {}) {
  // Decision 169: this is the day-0 VEEC signing request (one per job by key), sent from veec-reminders.server.ts.
  const { INSTALL_COMPLETE_EMAIL_APPROVED, ALL_DONE_V2_APPROVED, renderInstallCompleteEmail } = await import("./completion-emails.core");
  // Part 4 Task 9 (touchpoint 52): with ALL_DONE_V2_APPROVED this ONE email also carries the tax invoice, the rebate form, the
  // manufacturer's instructions and the contacts, whether or not the balance is paid. Same purpose and key as before.
  const v2 = opts.v2 ?? ALL_DONE_V2_APPROVED;
  let contacts: import("./completion-emails.core").AllDoneContacts | undefined;
  if (v2) {
    const ad = await import("./all-done.server");
    const c = await ad.allDoneContacts(jobId);
    if ("hold" in c) { await ad.logAllDoneHeld(jobId, c.hold); return `held — ${c.hold}`; }
    contacts = c.contacts;
  }
  // Decision 321: the manufacturer warranty PDF(s) for the installed product(s) go with this email, and
  // `warranty_copy_provided` is recorded after a confirmed send (no longer waiting for full payment). Missing PDF: send
  // anyway, record nothing (the AP signature holds with "Warranty copy for <product> not on file").
  const pw = await import("./product-warranty.server");
  let decision: Awaited<ReturnType<typeof pw.warrantyDecisionFor>> | null = null;
  let copies: Awaited<ReturnType<typeof pw.prepareWarrantyCopies>> = { attachments: [], attached: [], missing: [] };
  try { decision = await pw.warrantyDecisionFor(jobId); copies = await pw.prepareWarrantyCopies(jobId, null, decision); }
  catch (e) { console.error("All done email: warranty copy skipped", jobId, (e as Error).message); }
  const attachedNames = copies.attached.map((w) => w.productName);
  let extra: import("./email-kit.core").EmailAttachment[] = [];
  let attached: import("./completion-emails.core").AllDoneAttached | undefined;
  if (v2) {
    const ad = await import("./all-done.server");
    const made = await ad.allDoneAttachments(jobId, decision?.products ?? []);
    if (made.hold) { await ad.logAllDoneHeld(jobId, made.hold); return `held — ${made.hold}`; }
    extra = made.attachments;
    attached = { ...made.attached, warranty: copies.attached.length > 0 };
  }
  const all = [...copies.attachments, ...extra];
  const r = await sendOwnerTemplateEmail({ jobId, purpose: "install_complete", key: `install-complete:v1:${jobId}`, approved: INSTALL_COMPLETE_EMAIL_APPROVED, label: "Install complete email", notSentEvent: "install_complete_email_not_sent", ...(all.length ? { attachments: all } : {}),
    render: (f) => renderInstallCompleteEmail({ ...i, firstName: f.firstName, installer: { name: f.installerName, phone: f.installerPhone }, attachedWarranties: attachedNames, test: f.test, ...(v2 ? { contacts, attached, signAndPayUrl: `${f.myJobUrl}?screen=finish` } : {}) }, v2) });
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

/** Decision 334: once per invoice (key by invoice id); bank details from HIV_BANK_* env (payments.server bankDetails). */
export async function emailOwnerCompletionPack(jobId: string, downloads: import("./completion-emails.core").CompletionPackInput["downloads"], installedGiven?: import("./completion-emails.core").InstalledLine | null,
  extras: { attachments?: import("./email-kit.core").EmailAttachment[]; attachedWarranties?: string[]; attachedCoes?: boolean; retryAfterDefiniteFailure?: boolean } = {}) {
  const { COMPLETION_EMAILS_APPROVED, renderCompletionPackEmail } = await import("./completion-emails.core");
  const installed = await installedLineFor(jobId, installedGiven);
  return sendOwnerTemplateEmail({ jobId, purpose: "completion_pack", key: COMPLETION_PACK_EMAIL_KEY(jobId), approved: COMPLETION_EMAILS_APPROVED, label: "Completion pack email", notSentEvent: "completion_pack_email_not_sent", ...(extras.attachments?.length ? { attachments: extras.attachments } : {}), ...(extras.retryAfterDefiniteFailure ? { retryAfterDefiniteFailure: true } : {}),
    render: (f) => renderCompletionPackEmail({ firstName: f.firstName, installer: { name: f.installerName, phone: f.installerPhone }, downloads, installed, attachedWarranties: extras.attachedWarranties ?? [], attachedCoes: extras.attachedCoes === true, test: f.test }) });
}

export async function emailOwnerReviewRequest(jobId: string, i: { googleReviewUrl: string; referralUrl: string }) {
  const { COMPLETION_EMAILS_APPROVED, renderReviewRequestEmail } = await import("./completion-emails.core");
  return sendOwnerTemplateEmail({ jobId, purpose: "review_request", key: ownerEmailKey.reviewRequest(jobId), approved: COMPLETION_EMAILS_APPROVED, label: "Review request email", notSentEvent: "review_request_email_not_sent",
    render: (f) => renderReviewRequestEmail({ firstName: f.firstName, installer: { name: f.installerName, phone: f.installerPhone }, starUrl: (n) => `${f.myJobUrl}?screen=review&stars=${n}`, googleReviewUrl: i.googleReviewUrl, referralUrl: i.referralUrl, test: f.test }) });
}
