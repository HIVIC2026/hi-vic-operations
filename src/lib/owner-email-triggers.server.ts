// Decision 325 (25 Oct 2026): workflow triggers for the approved owner emails in approved-owner-emails.server.ts.
// Each trigger reads the facts its approved renderer needs, records ONE internal `owner_email_triggered` event per
// idempotency key BEFORE sending (decision 165), then calls the one guarded sender (sendOwnerTemplateEmail): TEST jobs
// → test-send; real owners only with the template's *_APPROVED flag, customer_comms_enabled + consent
// (assertCustomerDeliveryAllowed) and the once-only customer_email_sends reservation. A failed real send is a `failed`
// customer_email_sends row, which send-failed.core.ts already turns into a Needs me row. Every function is best-effort:
// it never throws, so the workflow action that called it is never broken by an email. Rules: owner-email-triggers.core.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { inHouseDispatchSkip } from "./in-house-suppression.server";
import {
  OWNER_EMAIL_LABEL, OWNER_EMAIL_TRIGGER_EVENT, OWNER_REVIEW_SCREEN_READY, REVIEW_REQUEST_AFTER_DAYS, REVIEW_REQUEST_LAST_DAY, dayMonthLabel, directMoveFrom, installDayMove, ownerEmailKey, quoteReminderDue,
  reviewRequestBlocker, reviewRequestDue, safetyCheckPaidAt, weekdayDayMonthLabel, youreInDue, type OwnerEmailCode, type QuoteReminderKind,
} from "./owner-email-triggers.core";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Once per key: record the event, then send. Never throws. */
export async function fireOwnerEmailOnce(jobId: string, code: OwnerEmailCode, key: string, send: () => Promise<string>, details: Record<string, unknown> = {}): Promise<string> {
  try {
    const { count, error } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", OWNER_EMAIL_TRIGGER_EVENT).contains("details", { key });
    if (error) return `skipped — ${error.message}`;
    if (count) return "already handled";
    await logEvent(jobId, null, OWNER_EMAIL_TRIGGER_EVENT, `${code} ${OWNER_EMAIL_LABEL[code]} prepared for the owner`, { code, key, ...details }, { internal: true });
    return await send();
  } catch (e) {
    console.error(`owner email ${code} skipped`, jobId, errText(e));
    return `not sent — ${errText(e)}`;
  }
}

async function electricianFor(jobId: string): Promise<{ name: string | null; phone: string | null }> {
  const { data } = await admin.from("job_assignments").select("businesses(name, trading_name, phone)").eq("job_id", jobId).eq("role", "electrician").eq("active", true).maybeSingle();
  const b = (data?.businesses ?? null) as { name: string | null; trading_name: string | null; phone: string | null } | null;
  return { name: (b?.trading_name ?? b?.name ?? null)?.replace(/^\[TEST PARTNER\]\s*/, "") ?? null, phone: b?.phone ?? null };
}

/** Safety check amount the owner has paid (dollars), or null while it is not paid. */
async function safetyCheckPaid(jobId: string): Promise<number | null> {
  const { jobPaymentView } = await import("./payments.server");
  const v = await jobPaymentView(jobId).catch(() => null);
  const s = v?.steps.find((x) => x.key === "safety_check");
  return v && s?.state === "paid" && v.plan.safetyCheckCents > 0 ? v.plan.safetyCheckCents / 100 : null;
}

// ---------- O26: safety check times / booked ----------

/** O26: the electrician offered PIESA time(s) to the owner (piesa-times.server.ts, decision 333; old pilot.functions.ts proposeTime). */
export async function onSafetyCheckTimesOffered(jobId: string, startsAt: string[]): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  return fireOwnerEmailOnce(jobId, "O26", ownerEmailKey.safetyCheckTimes(jobId, startsAt), async () => {
    const [el, paid] = await Promise.all([electricianFor(jobId), safetyCheckPaid(jobId)]);
    const { emailOwnerSafetyCheckTimes } = await import("./approved-owner-emails.server");
    return emailOwnerSafetyCheckTimes(jobId, startsAt, el.name, paid);
  });
}

/** O26 booked version: the PIESA visit is booked (booking.server.ts confirmBooking, kind assessment). */
export async function onSafetyCheckBooked(jobId: string, startIso: string, changed: boolean): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  return fireOwnerEmailOnce(jobId, "O26_booked", ownerEmailKey.safetyCheckBooked(jobId, startIso), async () => {
    const el = await electricianFor(jobId);
    const { emailOwnerSafetyCheckBooked } = await import("./approved-owner-emails.server");
    return emailOwnerSafetyCheckBooked(jobId, startIso, el, changed);
  }, { changed });
}

// ---------- O29: electrical fixes quote ----------

/** O29: the office sent the reviewed electrical fixes quote (allocation.functions.ts sendRectificationQuote). */
export async function onFixesQuoteIssued(jobId: string, quoteId: string): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  return fireOwnerEmailOnce(jobId, "O29", ownerEmailKey.fixesQuote(quoteId), async () => {
    const { piesaStatus } = await import("./workflow.server");
    const [{ data: q }, { data: items }, { data: found }, el, ps] = await Promise.all([
      admin.from("quotes").select("customer_total_inc_gst, kind").eq("id", quoteId).eq("job_id", jobId).maybeSingle(),
      admin.from("quote_items").select("description, line_total_inc_gst, sort").eq("quote_id", quoteId),
      admin.from("rectification_items").select("description").eq("job_id", jobId).eq("status", "required"),
      electricianFor(jobId),
      piesaStatus(jobId),
    ]);
    if (!q || q.kind !== "rectification") return "not sent — fixes quote not found";
    const lines = [...(items ?? [])].sort((a, b) => Number(a.sort ?? 0) - Number(b.sort ?? 0)).map((l) => ({ description: String(l.description ?? ""), lineTotalIncGst: Number(l.line_total_inc_gst) }));
    const p = ps as { piesa_date?: string | null; install_deadline?: string | null } | null;
    const { emailOwnerFixesQuote } = await import("./approved-owner-emails.server");
    return emailOwnerFixesQuote(jobId, quoteId, {
      electricianName: el.name, checkedOn: weekdayDayMonthLabel(p?.piesa_date ?? null),
      found: (found ?? []).map((r) => String(r.description ?? "").trim()).filter(Boolean),
      lines, totalIncGst: Number(q.customer_total_inc_gst), expiresOn: dayMonthLabel(p?.install_deadline ?? null),
    });
  });
}

// ---------- O33 / O42: install days ----------

/** Owner's remaining balance after the safety check (the 10% deposit base), dollars; null without an invoice. */
async function balanceAfterSafetyCheck(jobId: string): Promise<number | null> {
  const v = await (await import("./payments.server")).jobPaymentView(jobId).catch(() => null);
  return v ? Math.max(0, v.plan.quoteTotalCents - v.plan.safetyCheckCents) / 100 : null;
}

/** O33: the installer offered install days (install-days.server.ts installerOfferDays). `deadline` = YYYY-MM-DD install-by. */
export async function onInstallDaysOffered(jobId: string, startsAt: string[], deadline: string | null): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  return fireOwnerEmailOnce(jobId, "O33", ownerEmailKey.installDays(jobId, startsAt), async () => {
    const balance = await balanceAfterSafetyCheck(jobId);
    const { emailOwnerInstallDays } = await import("./approved-owner-emails.server");
    return emailOwnerInstallDays(jobId, startsAt, balance, dayMonthLabel(deadline));
  });
}

/** The earlier booked start when this new installation booking follows an installer's day change; null otherwise. */
export async function installDayMoveFor(jobId: string, newStart: string): Promise<string | null> {
  try {
    const [{ data: ev }, { data: books }] = await Promise.all([
      admin.from("workflow_events").select("created_at, details").eq("job_id", jobId).eq("event_type", "install_day_changed").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      admin.from("bookings").select("created_at, scheduled_start, status").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(2),
    ]);
    const d = (ev?.details ?? null) as { was?: string | null; who?: string | null } | null;
    // books[0] is the booking just written; books[1] is the one before it.
    const previous = (books ?? [])[1] ?? null;
    return installDayMove({ newStart, change: ev ? { at: ev.created_at, was: d?.was ?? null, who: d?.who ?? null } : null, previousBookingAt: previous?.created_at ?? null })?.was ?? null;
  } catch (e) {
    console.error("install day move check skipped", jobId, errText(e));
    return null;
  }
}

/** O42: a booked install day moved from `wasIso` to `startIso`. */
export async function onInstallDayMoved(jobId: string, startIso: string, wasIso: string): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  return fireOwnerEmailOnce(jobId, "O42", ownerEmailKey.installDayChanged(jobId, startIso), async () => {
    const { emailOwnerInstallDayChanged } = await import("./approved-owner-emails.server");
    return emailOwnerInstallDayChanged(jobId, startIso, wasIso);
  }, { was: wasIso });
}

/** confirmBooking at the booked stage (a direct reschedule): O42 when the confirmed start really changed. */
export async function onInstallBookingRescheduled(jobId: string, startIso: string, priorStart: string | null): Promise<string> {
  const was = directMoveFrom(priorStart, startIso);
  return was ? onInstallDayMoved(jobId, startIso, was) : "not a move";
}

// ---------- O22: You're in + safety check receipt ----------

async function signedAcceptanceAttachment(jobId: string, jobNumber: string | null): Promise<import("./email-kit.core").EmailAttachment[]> {
  const { data: doc } = await admin.from("documents").select("storage_path").eq("job_id", jobId).eq("kind", "customer_agreement").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!doc?.storage_path) return [];
  const { data, error } = await admin.storage.from("job-files").download(doc.storage_path);
  if (error || !data) return [];
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length) return [];
  const { bytesToBase64 } = await import("./veec-emails.core");
  return [{ filename: `Signed acceptance${jobNumber ? ` ${jobNumber}` : ""}.pdf`, content: bytesToBase64(bytes), contentType: "application/pdf" }];
}

/**
 * O22 (decision 90): once the safety check payment on the accepted quote's invoice is received (payments.server.ts
 * afterPaymentsChanged — Xero sync, Stripe webhook or office record). Receipt = amount + the day the ledger reached
 * the step; the signed acceptance PDF is attached when it can be read.
 */
export async function onSafetyCheckPaid(jobId: string, invoiceId: string): Promise<string> {
  const skipped = await inHouseDispatchSkip(jobId);
  if (skipped) return skipped;
  try {
    const { jobPaymentView } = await import("./payments.server");
    const v = await jobPaymentView(jobId);
    const step = v?.steps.find((s) => s.key === "safety_check");
    if (!v || v.invoiceId !== invoiceId || step?.state !== "paid" || v.plan.safetyCheckCents <= 0) return "not due";
    const { data: inv } = await admin.from("invoices").select("quote_id, quotes(status, veec_discount_inc_gst)").eq("id", invoiceId).maybeSingle();
    const quote = (inv?.quotes ?? null) as { status: string | null; veec_discount_inc_gst: number | string | null } | null;
    if (!inv?.quote_id || quote?.status !== "accepted") return "not due — quote not accepted";
    const quoteId = inv.quote_id;
    const paidAt = safetyCheckPaidAt(v.ledger, v.plan.thresholds.safety_check);
    const { data: job } = await admin.from("jobs").select("job_number, stage, deleted_at").eq("id", jobId).maybeSingle();
    if (!job || !paidAt || !youreInDue({ paidAt, stage: job.stage as string, deletedAt: job.deleted_at }, new Date())) return "not due — no recent safety check payment";
    return fireOwnerEmailOnce(jobId, "O22", ownerEmailKey.youreIn(quoteId), async () => {
      const attachments = await signedAcceptanceAttachment(jobId, job?.job_number ?? null).catch(() => []);
      const { emailOwnerYoureIn } = await import("./approved-owner-emails.server");
      return emailOwnerYoureIn(jobId, quoteId, {
        rebate: quote.veec_discount_inc_gst == null ? null : Number(quote.veec_discount_inc_gst),
        totalIncGst: v.plan.quoteTotalCents / 100,
        payment: { amount: v.plan.safetyCheckCents / 100, paidOn: weekdayDayMonthLabel(paidAt) ?? "today" },
      }, attachments);
    }, { invoice_id: invoiceId });
  } catch (e) {
    console.error("owner email O22 skipped", jobId, errText(e));
    return `not sent — ${errText(e)}`;
  }
}

// ---------- O45: final invoice (decision 334) ----------

/** Facts + due check for one job's final invoice; null when it is not due (with the reason). Read-only. */
type FinalInvoiceDue = { ok: false; reason: string } | { ok: true; invoiceId: string; facts: ReturnType<typeof import("./final-invoice-email.core").finalInvoiceFacts> };
async function finalInvoiceFor(jobId: string, now: Date): Promise<FinalInvoiceDue> {
  const { finalInvoiceBlocker, finalInvoiceFacts } = await import("./final-invoice-email.core");
  const [{ data: job }, { data: inv }] = await Promise.all([
    admin.from("jobs").select("stage, deleted_at, qa_archived_at, installation_completed_at").eq("id", jobId).maybeSingle(),
    admin.from("invoices").select("id, quote_id, total_inc_gst, total_paid, xero_invoice_id, xero_invoice_number, quotes(veec_discount_inc_gst, quote_items(code, description, quantity, unit_price_inc_gst, line_total_inc_gst, sort))").eq("job_id", jobId).eq("kind", "installation").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (!job) return { ok: false, reason: "Job not found" };
  const { paymentLedger } = await import("./payments.server");
  const ledger = inv ? await paymentLedger(jobId, inv.id) : [];
  const quote = (inv?.quotes ?? null) as { veec_discount_inc_gst: number | string | null; quote_items: { code: string | null; description: string; quantity: number; unit_price_inc_gst: number; line_total_inc_gst: number; sort: number | null }[] } | null;
  // Decision 209: the same itemised insulation wording as the Xero invoice (amounts untouched).
  const { itemiseInvoiceLines } = await import("./invoice-itemisation.core");
  const { installedProductFacts } = await import("./invoice-itemisation.server");
  const items = quote ? itemiseInvoiceLines(quote.quote_items.map((q) => ({ ...q, sort: Number(q.sort ?? 0) })).sort((a, b) => a.sort - b.sort), await installedProductFacts(jobId)).items : [];
  const facts = inv && job.installation_completed_at ? finalInvoiceFacts({
    invoiceNumber: inv.xero_invoice_number ?? "", completedAt: job.installation_completed_at, items, invoiceTotalIncGst: inv.total_inc_gst,
    veecIncentiveIncGst: quote?.veec_discount_inc_gst ?? null, ledger, totalPaid: inv.total_paid,
  }) : null;
  const done = inv ? (await recordedKeys([jobId], "O45")).has(ownerEmailKey.finalInvoice(inv.id)) : false;
  const reason = finalInvoiceBlocker({
    installationCompletedAt: job.installation_completed_at, stage: job.stage as string, deletedAt: job.deleted_at, qaArchivedAt: job.qa_archived_at,
    invoice: inv ? { id: inv.id, xeroInvoiceId: inv.xero_invoice_id, xeroInvoiceNumber: inv.xero_invoice_number } : null,
    balanceDueCents: facts?.balanceDueCents ?? 0, done,
  }, now);
  if (reason || !inv || !facts) return { ok: false, reason: reason ?? "No invoice facts" };
  return { ok: true, invoiceId: inv.id as string, facts };
}

/**
 * O45 (decision 334): install recorded complete with a balance due → the final invoice email, once per invoice
 * (install-complete.server.ts recordInstallationComplete; the 15-minute sweep retries once the Xero invoice number exists).
 * Bank transfer only: the bank details come from HIV_BANK_* (payments.server bankDetails), the invoice number is the
 * reference. No Xero PDF is fetched (the Xero integration reads JSON only), so "Invoice PDF attached" is never printed.
 */
export async function onFinalInvoiceDue(jobId: string, now = new Date()): Promise<string> {
  try {
    const due = await finalInvoiceFor(jobId, now);
    if (!due.ok) return `not due — ${due.reason}`;
    const invoiceId = due.invoiceId;
    const { balanceDueCents: _b, ...facts } = due.facts;
    return fireOwnerEmailOnce(jobId, "O45", ownerEmailKey.finalInvoice(invoiceId), async () => {
      const { bankDetails } = await import("./payments.server");
      const { emailOwnerFinalInvoice } = await import("./approved-owner-emails.server");
      return emailOwnerFinalInvoice(jobId, invoiceId, { ...facts, bank: bankDetails(), invoicePdfAttached: false });
    }, { invoice_id: invoiceId, balance_due: facts.balanceDue });
  } catch (e) {
    console.error("owner email O45 skipped", jobId, errText(e));
    return `not sent — ${errText(e)}`;
  }
}

/** O45 retry on the 15-minute tick: installs recorded complete in the last FINAL_INVOICE_WITHIN_DAYS days. */
export async function sweepFinalInvoices(now = new Date()): Promise<{ checked: number; sent: number }> {
  const { FINAL_INVOICE_WITHIN_DAYS } = await import("./final-invoice-email.core");
  const from = new Date(now.getTime() - FINAL_INVOICE_WITHIN_DAYS * 86_400_000).toISOString();
  const { data: jobs, error } = await admin.from("jobs").select("id").gte("installation_completed_at", from).is("deleted_at", null).limit(500);
  if (error) throw new Error(error.message);
  // Perf 25 Oct 2026: a job whose latest installation invoice already has its O45 key recorded is "done" (the same
  // `done` finalInvoiceFor computes after five reads per job); read both for every candidate at once and skip those.
  const ids = (jobs ?? []).map((j) => j.id);
  const { readByJobIds } = await import("./sweep-batch.server");
  const { latestPerJob } = await import("./sweep-batch.core");
  const [invoices, done] = await Promise.all([
    readByJobIds<{ id: string; job_id: string | null; created_at: string }>("installation invoices", ids, (c) => admin.from("invoices").select("id, job_id, created_at").in("job_id", c).eq("kind", "installation")),
    recordedKeysBatched(ids, "O45"),
  ]);
  const latestInvoice = latestPerJob(invoices);
  let sent = 0;
  for (const j of jobs ?? []) {
    const inv = latestInvoice.get(j.id);
    if (inv && done.has(ownerEmailKey.finalInvoice(inv.id))) continue;
    if (/^sent\b/.test(await onFinalInvoiceDue(j.id, now))) sent++;
  }
  return { checked: (jobs ?? []).length, sent };
}

// ---------- 15-minute tick: O19 quote reminders, O51 review request ----------

async function optedOutJobs(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const [{ data: a, error: ae }, { data: b, error: be }] = await Promise.all([
    admin.from("customer_email_optouts").select("job_id, opted_out_at").in("job_id", ids),
    admin.from("lead_campaign_responses").select("job_id, opted_out_at").in("job_id", ids),
  ]);
  if (ae || be) throw new Error(`Could not read opt-outs: ${(ae ?? be)!.message}`);
  return new Set([...(a ?? []), ...(b ?? [])].filter((r) => !!r.opted_out_at).map((r) => r.job_id as string));
}

/** recordedKeys over any number of jobs (bounded id chunks). */
async function recordedKeysBatched(ids: string[], code: OwnerEmailCode): Promise<Set<string>> {
  const { chunkIds } = await import("./sweep-batch.core");
  const sets = await Promise.all(chunkIds(ids).map((c) => recordedKeys(c, code)));
  return new Set(sets.flatMap((x) => [...x]));
}

async function recordedKeys(ids: string[], code: OwnerEmailCode): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await admin.from("workflow_events").select("details").in("job_id", ids).eq("event_type", OWNER_EMAIL_TRIGGER_EVENT).contains("details", { code });
  if (error) throw new Error(`Could not read owner email events: ${error.message}`);
  return new Set((data ?? []).map((r) => String((r.details as { key?: unknown } | null)?.key ?? "")).filter(Boolean));
}

/** O19 (decisions 88/89/134): day-3 and 2-days-before-expiry reminders for open installation quotes. */
export async function sweepQuoteReminders(now = new Date()): Promise<{ checked: number; due: number; sent: number }> {
  const { data: quotes, error } = await admin.from("quotes").select("id, job_id, kind, status, release_state, sent_at").eq("kind", "installation").eq("status", "issued").not("sent_at", "is", null).limit(500);
  if (error) throw new Error(error.message);
  const ids = [...new Set((quotes ?? []).map((q) => q.job_id as string))];
  if (!ids.length) return { checked: 0, due: 0, sent: 0 };
  const [{ data: jobs, error: je }, opted, done] = await Promise.all([
    admin.from("jobs").select("id, stage, deleted_at, qa_archived_at, owner_id, property_id").in("id", ids),
    optedOutJobs(ids), recordedKeys(ids, "O19"),
  ]);
  if (je) throw new Error(je.message);
  const byId = new Map((jobs ?? []).map((j) => [j.id as string, j]));
  let due = 0, sent = 0;
  for (const q of quotes ?? []) {
    const job = byId.get(q.job_id);
    if (!job) continue;
    const kinds = (["day3", "expiry"] as QuoteReminderKind[]).filter((k) => done.has(ownerEmailKey.quoteReminder(q.id, k)));
    const kind = quoteReminderDue({ quote: q, job: { stage: job.stage as string, deleted_at: job.deleted_at, qa_archived_at: job.qa_archived_at }, done: kinds, optedOut: opted.has(q.job_id) }, now);
    if (!kind) continue;
    due++;
    try {
      // Facts first: with no total or no secure link nothing is recorded, so the reminder goes once they exist.
      const { data: owner } = await admin.from("owners").select("full_name").eq("id", job.owner_id).maybeSingle();
      const { loadOwnerQuoteFacts } = await import("./quote-ready-notify.server");
      const facts = await loadOwnerQuoteFacts(q.job_id, q.id, owner?.full_name ?? null, job.property_id ?? null);
      if (!facts.input) continue;
      const { firstName: _f, ...quote } = facts.input;
      const r = await fireOwnerEmailOnce(q.job_id, "O19", ownerEmailKey.quoteReminder(q.id, kind), async () =>
        (await import("./approved-owner-emails.server")).emailOwnerQuoteReminder(q.job_id, q.id, kind, quote), { quote_id: q.id, kind });
      if (/^sent\b/.test(r)) sent++;
    } catch (e) { console.error("quote reminder skipped", q.job_id, errText(e)); }
  }
  return { checked: (quotes ?? []).length, due, sent };
}

/** O51 (decision 105): one review request a week after the install. Held (nothing recorded) while reviewRequestBlocker says so. */
export async function sweepReviewRequests(now = new Date()): Promise<{ held?: string; checked: number; sent: number }> {
  const googleReviewUrl = process.env["HIV_GOOGLE_REVIEW_URL"]?.trim() || null;
  const held = reviewRequestBlocker({ googleReviewUrl, reviewScreenReady: OWNER_REVIEW_SCREEN_READY });
  if (held) return { held, checked: 0, sent: 0 };
  const from = new Date(now.getTime() - REVIEW_REQUEST_LAST_DAY * 86_400_000).toISOString();
  const to = new Date(now.getTime() - REVIEW_REQUEST_AFTER_DAYS * 86_400_000).toISOString();
  const { data: jobs, error } = await admin.from("jobs").select("id, stage, deleted_at, qa_archived_at, installation_completed_at").gte("installation_completed_at", from).lte("installation_completed_at", to).is("deleted_at", null).limit(500);
  if (error) throw new Error(error.message);
  const ids = (jobs ?? []).map((j) => j.id as string);
  const [opted, done] = await Promise.all([optedOutJobs(ids), recordedKeys(ids, "O51")]);
  let sent = 0;
  for (const j of jobs ?? []) {
    if (!reviewRequestDue({ installationCompletedAt: j.installation_completed_at, stage: j.stage as string, deletedAt: j.deleted_at, qaArchivedAt: j.qa_archived_at, done: done.has(ownerEmailKey.reviewRequest(j.id)), optedOut: opted.has(j.id) }, now)) continue;
    try {
      const { referralUrlForJob } = await import("./referral.server");
      const referralUrl = await referralUrlForJob(j.id);
      const r = await fireOwnerEmailOnce(j.id, "O51", ownerEmailKey.reviewRequest(j.id), async () =>
        (await import("./approved-owner-emails.server")).emailOwnerReviewRequest(j.id, { googleReviewUrl: googleReviewUrl!, referralUrl }));
      if (/^sent\b/.test(r)) sent++;
    } catch (e) { console.error("review request skipped", j.id, errText(e)); }
  }
  return { checked: ids.length, sent };
}
