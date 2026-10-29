// Needs me (O1) + the Job page Next panel (O2): gathers the facts once, then the pure rules in office-needs.core decide
// the rows and job-next-action.core the Next sentence. Read-only: never moves a job, never sends anything.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { loadOffice, type OfficeJob } from "./office.server";
import { buildNeedsRows, duplicatesInvoiceFailed, type EmailRowInput, type NeedsFacts, type NeedsRow, type SystemRow } from "./office-needs.core";
import { FAILED_EMAIL_STATUSES, FAILED_SMS_STATUSES, SUCCESS_EMAIL_STATUSES, SUCCESS_SMS_STATUSES, UNSURE_EMAIL_STATUSES, UNSURE_SMS_STATUSES, partnerSendFailedRows, sendFailedRows, tradeTextCoveredKeys } from "./send-failed.core";
import { AUTO_OFFER_RETURNED_EVENT } from "./auto-offer.core";
import { surnameOf } from "./office-jobs.core";
import { VEEC_OFFICE_ALERT_EVENT } from "./veec-assignment-form.core";
import { apAutoHoldAlert } from "./veec-ap-auto.core";
import { consentApHoldAlert } from "./consent-ap-auto.core";
import { PIESA_OWNER_CONFIRMED_EVENT, PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT } from "./piesa-owner-confirm.core";
import { FIXES_PAUSED_STAGES } from "./installer-screens.core";
import { PIESA_FIXES_CONFIRMED_EVENT, PIESA_FIXES_CONFIRM_OFFICE_ALERT_EVENT } from "./piesa-fixes-confirm.core";
import { FIXES_TIMES_GIVEN_EVENT, FIXES_TIMES_LINK_EVENT, fixesTimesMissing } from "./fixes-times.core";
import { AUTO_FIXES_QUOTE_HELD_EVENT } from "./auto-fixes-quote-send.core";
import { PIESA_AUTOFORM_FAILED_EVENT, piesaFormFailedOpen } from "./piesa-autoform.core";
import { prestartFailedFor } from "./prestart.core";
import type { PaymentStepKey } from "./payments.core";

type Row = Record<string, unknown>;
const s = (v: unknown) => (v == null ? null : String(v));
const DAY = 86_400_000;

/** Reads every row (pages of 1000) and fails loudly — a failed read must never look like "nothing needs you". */
async function all(what: string, page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(`Could not load ${what}: ${error.message}`);
    out.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) return out;
  }
}
/** Job-id lookups are batched (AGENTS: one all-ids URL stalled Office reads for minutes). */
async function byIds(what: string, ids: string[], q: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += 150) chunks.push(ids.slice(i, i + 150));
  return (await Promise.all(chunks.map((chunk) => all(what, (f, t) => q(chunk, f, t))))).flat();
}

/** Batch 3a: the "new quote asked for" Needs me fact per job (pure rule `newQuoteOfficeFact`). */
export async function newQuoteOfficeFacts(jobIds: string[]): Promise<Map<string, import("./new-quote-request.core").NewQuoteOfficeFact>> {
  const out = new Map<string, import("./new-quote-request.core").NewQuoteOfficeFact>();
  if (!jobIds.length) return out;
  const { NEW_QUOTE_NEEDS_INSTALLER_EVENT, NEW_QUOTE_UNFINISHED_EVENT, newQuoteOfficeFact } = await import("./new-quote-request.core");
  const [ev, qs] = await Promise.all([
    byIds("new quote requests", jobIds, (c, a, b) => admin.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", [NEW_QUOTE_NEEDS_INSTALLER_EVENT, NEW_QUOTE_UNFINISHED_EVENT]).range(a, b)),
    byIds("quotes of new quote requests", jobIds, (c, a, b) => admin.from("quotes").select("job_id, created_at").in("job_id", c).eq("kind", "installation").range(a, b)),
  ]);
  for (const id of jobIds) {
    const hit = newQuoteOfficeFact(ev.filter((e) => e["job_id"] === id).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as Record<string, unknown> | null })),
      { quoteCreatedAts: qs.filter((q) => q["job_id"] === id).map((q) => String(q["created_at"])) });
    if (hit) out.set(id, hit);
  }
  return out;
}

/** Batch 3a: base facts for jobs still closed by an expired quote ("Quote expired (14 days)"). They are not in the
 *  open-jobs list, but their expired-quote / new-quote office rows still need to show. Deleted (and, unless asked, TEST)
 *  jobs are left out. */
export async function expiryClosedJobFacts(jobIds: string[], includeTest: boolean): Promise<Map<string, NeedsFacts>> {
  const out = new Map<string, NeedsFacts>();
  if (!jobIds.length) return out;
  const { QUOTE_EXPIRED_CANCEL_REASON } = await import("./quote-expiry.core");
  const rows = await byIds("jobs closed by an expired quote", jobIds, (c, a, b) => admin.from("jobs").select("id, job_number, source, deleted_at, stage, cancelled_reason, owners(full_name), properties(suburb)").in("id", c).range(a, b));
  for (const j of rows) {
    if (j["deleted_at"] || j["stage"] !== "cancelled" || j["cancelled_reason"] !== QUOTE_EXPIRED_CANCEL_REASON) continue;
    if (!includeTest && j["source"] === "qa_test") continue;
    out.set(String(j["id"]), { jobId: String(j["id"]), jobNumber: String(j["job_number"]), surname: surnameOf((j["owners"] as { full_name?: string } | null)?.full_name), suburb: (j["properties"] as { suburb?: string } | null)?.suburb ?? null, ...(j["source"] === "qa_test" ? { isTest: true } : {}) });
  }
  return out;
}

export type GatheredNeeds = {
  now: number; jobs: OfficeJob[]; facts: Map<string, NeedsFacts>; emails: EmailRowInput[];
  system: SystemRow[];
  /** Plain names of reads that failed without stopping the page — the page says they couldn't load. */
  unavailable: string[];
};

/** Facts for every live job (Needs me) or for `onlyIds` (the Job page). The same derivation feeds both.
 *  Perf 25 Oct 2026: three waves instead of ~40 sequential round trips — (1) the office facts and every Needs-me read
 *  that does not depend on them, (2) the few follow-up reads keyed by what wave 1 found, (3) the pure rules. */
export async function gatherNeedsFacts(opts: { includeTest: boolean; onlyIds?: string[]; testOffice?: boolean }): Promise<GatheredNeeds> {
  const t0 = Date.now();
  const since7 = new Date(t0 - 7 * DAY).toISOString();
  const scoped = <T extends { in: (c: string, v: string[]) => T }>(q: T) => (opts.onlyIds ? q.in("job_id", opts.onlyIds) : q);
  const listMode = !opts.onlyIds;
  const { loadQuotesToCheck } = await import("./installer-quote-review.server");
  // Jo 28 Oct 2026 ("Alert after 3 days unpaid"): the plan maths for the unpaid-payment alert.
  const { paymentPlan, fixesCountedCents, repeatCreditCents, toCents, INSTALL_DEPOSIT_DUE_STAGES, installDepositDueNow } = await import("./payments.core");
  const { openRobotFailureRows } = await import("./esc-registry-robot.server");
  const { PIISA_AUDIT_CREATED_EVENT, PIISA_AUTOSEND_OFFICE_EVENT, piisaFormFailedOpen } = await import("./piisa-autosend.core");
  const { OWNER_REVIEW_FEEDBACK_EVENT, REVIEW_FEEDBACK_ROW_DAYS, reviewFeedbackRows } = await import("./owner-review.core");
  const { openEmailItems } = await import("./email-office.server");
  const { CHANGE_LINE } = await import("./office-needs.core");
  const unavailable: string[] = [];

  // Review R04: owner emails whose delivery outcome is unknown (warranty follow-up, completion pack) are never resent —
  // one row each until the fact is recorded. Started alongside wave 1 (rare events, then their closing events by job id).
  const unknownSendsP = (async () => {
    const [{ WARRANTY_FOLLOWUP_EVENT_NAMES, WARRANTY_FOLLOWUP_UNKNOWN_LINE }, { COMPLETION_PACK_SEND_EVENTS, COMPLETION_PACK_UNKNOWN_LINE }, { unknownSendOpen }] = await Promise.all([import("./warranty-followup.core"), import("./completion-pack.core"), import("./send-outcome.core")]);
    const flows = [{ names: WARRANTY_FOLLOWUP_EVENT_NAMES, text: WARRANTY_FOLLOWUP_UNKNOWN_LINE, closedBy: "warranty_copy_provided" }, { names: COMPLETION_PACK_SEND_EVENTS, text: COMPLETION_PACK_UNKNOWN_LINE, closedBy: null }];
    const unknown = await all("unknown email outcomes", (a, b) => scoped(admin.from("workflow_events").select("job_id")).in("event_type", flows.map((x) => x.names.unknown)).range(a, b));
    const ids = [...new Set(unknown.map((e) => String(e["job_id"])))];
    if (!ids.length) return [] as { jobId: string; at: string; text: string }[];
    const types = [...new Set(flows.flatMap((x) => [x.names.attempt, x.names.sent, x.names.failed, x.names.unknown, x.closedBy]).filter((t): t is string => !!t))];
    const ev = await byIds("unknown email outcome history", ids, (c, a, b) => admin.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", types).range(a, b));
    return ids.flatMap((id) => {
      const mine = ev.filter((e) => e["job_id"] === id).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as Record<string, unknown> | null }));
      for (const fl of flows) { const o = unknownSendOpen(mine, fl.names, !!fl.closedBy && mine.some((e) => e.event_type === fl.closedBy)); if (o) return [{ jobId: id, at: o.at, text: fl.text }]; }
      return [];
    });
  })();
  // Wave 1. Needs me reads only open jobs (complete / cancelled are always "ended" and were filtered out below anyway).
  const [office, consents, veecForms, escRows, emailFails, smsFails, tenDay, noAccess, veecAlerts, overdue, returned, provisionalBookings, piesaAlerts, piesaConfirms, fixesLinks, fixesGiven, fixesAlerts, fixesConfirms, rectDrafts, rectHolds, q, qTest, robotRows, piisaAlerts, items, recLinks, fb, prestartChecks, upcomingInstalls, piesaFormFails, payInvoices, payQuotes, paySettings, piesaCurRows, payRepeatEv] = await Promise.all([
    loadOffice(admin, { includeTest: opts.includeTest, ...(opts.onlyIds ? { onlyIds: opts.onlyIds } : { openOnly: true }) }),
    all("ESC consents", (a, b) => scoped(admin.from("owner_esc_consents").select("job_id, owner_signed_at, ap_signed_at, status, scheduled_start, created_at")).not("owner_signed_at", "is", null).is("ap_signed_at", null).range(a, b)),
    all("VEEC forms", (a, b) => scoped(admin.from("customer_assignments").select("job_id, installer_signed_at, ap_signed_at, consumer_signed_at, status, created_at")).eq("record_kind", "final_veec_assignment").neq("status", "cancelled").range(a, b)),
    all("ESC notices", (a, b) => scoped(admin.from("esc_notifications").select("job_id, due_by, earliest_send_at, scheduled_start, sent_at, status")).is("sent_at", null).gt("scheduled_start", new Date(t0).toISOString()).range(a, b)),
    all("failed emails", (a, b) => scoped(admin.from("customer_email_sends").select("job_id, purpose, status, created_at, error")).in("status", [...FAILED_EMAIL_STATUSES, ...UNSURE_EMAIL_STATUSES, ...SUCCESS_EMAIL_STATUSES]).gte("created_at", since7).order("created_at").order("id").range(a, b)),
    all("failed texts", (a, b) => scoped(admin.from("sms_messages").select("job_id, business_id, message_type, status, created_at, detail")).in("status", [...FAILED_SMS_STATUSES, ...UNSURE_SMS_STATUSES, ...SUCCESS_SMS_STATUSES]).gte("created_at", since7).order("created_at").order("id").range(a, b)),
    all("10-day flags", (a, b) => (opts.onlyIds ? admin.from("jobs").select("id, install_10day_flagged_at, stage").in("id", opts.onlyIds) : admin.from("jobs").select("id, install_10day_flagged_at, stage")).not("install_10day_flagged_at", "is", null).eq("stage", "installation_scheduling").range(a, b)),
    all("no-access reports", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", "trade_couldnt_get_in").contains("details", { visit: "install", needs_office: true }).order("created_at", { ascending: false }).range(a, b)),
    all("VEEC day-10 alerts", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at")).eq("event_type", VEEC_OFFICE_ALERT_EVENT).range(a, b)),
    all("overdue invoices", (a, b) => scoped(admin.from("invoice_status").select("job_id, effective_status, total_inc_gst, total_paid, deposit_due_date, balance_due_date")).eq("effective_status", "overdue").range(a, b)),
    // Decision 246: automatic offers that came back to the office (2 misses or no covering trade) -> "Choose again".
    all("auto offers returned", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, summary, details")).eq("event_type", AUTO_OFFER_RETURNED_EVENT).order("created_at", { ascending: false }).range(a, b)),
    all("install bookings on hold", (a, b) => scoped(admin.from("bookings").select("job_id, created_at, scheduled_start")).eq("kind", "installation").eq("status", "confirmed").gt("created_at", new Date(t0 - 2 * DAY).toISOString()).gt("scheduled_start", new Date(t0).toISOString()).range(a, b)),
    // Decision 296: day-5 alerts for an unconfirmed PIESA, cleared by a confirmation of the same PIESA record.
    all("PIESA owner day-5 alerts", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", PIESA_OWNER_CONFIRM_OFFICE_ALERT_EVENT).range(a, b)),
    all("PIESA owner confirmations", (a, b) => scoped(admin.from("workflow_events").select("job_id, details")).eq("event_type", PIESA_OWNER_CONFIRMED_EVENT).range(a, b)),
    // Decision 315: fixes-times links to electricians, cleared by the times being given (same event both paths write).
    all("fixes times links", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at")).eq("event_type", FIXES_TIMES_LINK_EVENT).range(a, b)),
    all("fixes times given", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at")).eq("event_type", FIXES_TIMES_GIVEN_EVENT).range(a, b)),
    // Decision 330: day-5 alerts for unconfirmed electrical fixes, cleared by a confirmation of the same fixes record.
    all("fixes owner day-5 alerts", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", PIESA_FIXES_CONFIRM_OFFICE_ALERT_EVENT).range(a, b)),
    all("fixes owner confirmations", (a, b) => scoped(admin.from("workflow_events").select("job_id, details")).eq("event_type", PIESA_FIXES_CONFIRMED_EVENT).range(a, b)),
    // Decision 354: an electrician-priced fixes quote goes out by itself; a held automatic send keeps the row.
    all("fixes quote drafts", (a, b) => scoped(admin.from("quotes").select("id, job_id, created_at")).eq("kind", "rectification").eq("status", "draft").range(a, b)),
    all("fixes quote holds", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", AUTO_FIXES_QUOTE_HELD_EVENT).order("created_at", { ascending: false }).range(a, b)),
    // Quotes to check — the one shared read (held with reasons, ready drafts, declined by the owner).
    opts.onlyIds?.length === 0 ? Promise.resolve({ rows: [], declined: [], notDrafted: [] }) : loadQuotesToCheck({ showTestJobs: !!opts.testOffice, ...(opts.onlyIds ? { onlyJobIds: opts.onlyIds } : {}) }),
    opts.includeTest && listMode ? loadQuotesToCheck({ showTestJobs: true }) : Promise.resolve(null),
    // Decision 272: the ESC Registry robot failed on a job → the office does that submission by hand.
    openRobotFailureRows(opts.onlyIds),
    // F15: the automatic install day (PIISA) form failed with the install today/tomorrow → one row until a form is created.
    all("install day form alerts", (a, b) => scoped(admin.from("workflow_events").select("job_id, event_type, created_at, details")).eq("event_type", PIISA_AUTOSEND_OFFICE_EVENT).gte("created_at", since7).range(a, b)),
    // Email rows (decisions 245/247): the backend's open items (email-office.server).
    opts.testOffice ? Promise.resolve({ changes: [], unmatched: [] }) : openEmailItems(),
    // A failed read is named in `unavailable` (the page says so), never shown as nothing.
    listMode ? (async () => (await import("./rec-auto-link.server")).recentRecLinkItems().catch(() => { unavailable.push("electrician links to installers"); return []; }))() : Promise.resolve([]),
    // Decision 335: 1–3 star private feedback → ONE row per job for 14 days (often on a closed job: read directly).
    listMode ? all("review feedback", (a, b) => admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", OWNER_REVIEW_FEEDBACK_EVENT).gte("created_at", new Date(t0 - REVIEW_FEEDBACK_ROW_DAYS * DAY).toISOString()).range(a, b)) : Promise.resolve([] as Row[]),
    // Decision 395: the day-before pre-start result for upcoming installs (prestart.server writes it from 12pm the day before).
    all("pre-start checks", (a, b) => scoped(admin.from("pre_start_checks").select("job_id, scheduled_start, passed, failures, checked_at")).gt("scheduled_start", new Date(t0).toISOString()).order("checked_at", { ascending: false }).range(a, b)),
    all("upcoming installs", (a, b) => scoped(admin.from("bookings").select("job_id, scheduled_start")).eq("kind", "installation").eq("status", "confirmed").gt("scheduled_start", new Date(t0).toISOString()).range(a, b)),
    // Decision 398: the A3 PIESA form was not created automatically at the PIESA booking.
    all("PIESA form failures", (a, b) => scoped(admin.from("workflow_events").select("job_id, created_at, details")).eq("event_type", PIESA_AUTOFORM_FAILED_EVENT).gte("created_at", new Date(t0 - 60 * DAY).toISOString()).range(a, b)),
    // Jo 28 Oct 2026 ("Alert after 3 days unpaid"): the unpaid-payment alert's facts — invoices, accepted quotes, the
    // safety-check setting, current PIESA outcomes and the repeat safety check events. All reads; nothing is stored.
    all("invoices for unpaid payments", (a, b) => scoped(admin.from("invoice_status").select("id, job_id, total_inc_gst, total_paid, created_at")).range(a, b)),
    all("accepted quotes for unpaid payments", (a, b) => scoped(admin.from("quotes").select("id, job_id, kind, accepted_at, customer_total_inc_gst")).eq("status", "accepted").in("kind", ["installation", "rectification"]).range(a, b)),
    admin.from("workflow_settings").select("safety_check_payment_inc_gst").eq("id", 1).maybeSingle().then((r) => (r.data ?? null) as Row | null),
    all("current PIESA outcomes for deposits", (a, b) => scoped(admin.from("piesa_records").select("job_id, outcome, section_c_signed_at")).eq("is_current", true).range(a, b)),
    all("repeat safety check events", (a, b) => scoped(admin.from("workflow_events").select("job_id, event_type, created_at, details")).in("event_type", ["repeat_piesa_payer_chosen", "repeat_piesa_accepted", "repeat_piesa_paid"]).order("created_at", { ascending: false }).range(a, b)),
  ]);
  const now = office.now;
  const jobs = office.jobs.filter((j) => j.status?.stage !== "ended" || j.stage === "on_hold");
  const ids = jobs.map((j) => j.id);
  const idSet = new Set(ids);
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const facts = new Map<string, NeedsFacts>();
  for (const j of jobs) facts.set(j.id, { jobId: j.id, jobNumber: j.jobNumber, surname: surnameOf(j.owner), suburb: j.suburb, ...(j.source === "qa_test" ? { isTest: true } : {}) });
  const f = (id: string) => facts.get(id);
  // Same 48h rule as the legacy exceptions queue; current Needs me must not silently omit it.
  if (ids.length) {
    const releases = await byIds("unconfirmed visit releases", ids, (chunk, a, b) => admin.from("contact_releases").select("job_id, visit_kind, released_at, job_assignments!inner(active, booking_confirmed_at)").in("job_id", chunk).is("revoked_at", null).range(a, b));
    const { coordinationState, visitIsCurrent } = await import("./allocation.core");
    for (const r of releases) {
      const id = String(r["job_id"]), x = f(id), j = jobById.get(id);
      const assignment = r["job_assignments"] as { active?: boolean; booking_confirmed_at?: string | null } | null;
      const visit = String(r["visit_kind"]);
      if (!x || !j || !assignment?.active || !visitIsCurrent(visit, j.stage) || !["ready_check", "piesa", "rectification", "installation"].includes(visit)) continue;
      if (coordinationState({ releasedAt: s(r["released_at"]), firstProposalAt: null, confirmedAt: assignment.booking_confirmed_at ?? null }, new Date(now)).state === "needs_office") x.bookingOverdue = { at: String(r["released_at"]), visit: visit as "ready_check" | "piesa" | "rectification" | "installation" };
    }
  }

  for (const j of jobs) {
    const x = f(j.id)!;
    const st = j.status;
    const n = j.needs;
    // Offer lapsed / declined (decision 220) — the office chooses again.
    if (n.tradeChoice) x.offerLapsed = { role: n.tradeChoice.kind === "ready_check" ? "installer" : "electrician", name: n.tradeChoice.name, declined: n.tradeChoice.status === "declined", at: j.facts.lastActivityAt ?? st?.since ?? new Date(now).toISOString() };
    else if (n.offerChoice?.state === "no_taker") x.offerLapsed = { role: n.offerChoice.kind === "ready_check" ? "installer" : "electrician", name: null, declined: false, at: st?.since ?? new Date(now).toISOString() };
    else if (n.offerChoice?.state === "choose" && n.offerChoice.kind === "ready_check") x.spotSaved = { at: j.facts.campaign?.spotSavedAt ?? st?.since ?? j.facts.createdAt };
    else if (n.offerChoice?.state === "choose" && n.offerChoice.kind === "piesa") x.electricianToChoose = { at: st?.since ?? j.facts.createdAt, usual: null };
    if (!x.spotSaved && !x.offerLapsed && st && ["enquiry.spot_saved", "enquiry.spot_saved_video"].includes(st.key)) x.spotSaved = { at: j.facts.campaign?.spotSavedAt ?? st.since };
    if (!x.electricianToChoose && !x.offerLapsed && st?.key === "quote.paid") x.electricianToChoose = { at: st.since, usual: null };
    if (st?.key === "safety.fix_held") x.fixesQuoteToCheck = { at: st.since, reason: st.detail };
    // Jo 28 Oct: a PIESA that found fixes tells the office once; leaves these stages when the fixes are done and Section C signed.
    if (FIXES_PAUSED_STAGES.has(j.stage)) x.fixesFound = { at: st?.since ?? j.facts.lastActivityAt ?? j.facts.createdAt, stage: j.stage };
    if (st?.key === "signoff.ap") x.finalCheck = { at: st.since, flags: 0 };
    // 30-day window lapsed with no install (decision 1/2): watch.
    if (j.facts.installDeadline && !j.facts.installedAt && ["installation_scheduling", "installation_booked", "piesa_complete"].includes(j.stage) && Date.parse(`${j.facts.installDeadline}T23:59:59+11:00`) < now) x.lapsedWindow = { deadline: j.facts.installDeadline };
  }
  // Jo 28 Oct: a current failed PIESA (fixes found) with no Section C pass yet also tells the office (stage may be piesa_complete).
  if (ids.length) {
    const cur = await byIds("current PIESA outcomes", ids, (chunk, a, b) => admin.from("piesa_records").select("job_id, kind, outcome, created_at").in("job_id", chunk).eq("is_current", true).range(a, b));
    for (const r of cur) {
      const x = f(String(r["job_id"])); const j = jobById.get(String(r["job_id"]));
      if (x && j && !x.fixesFound && r["outcome"] === "fail" && r["kind"] !== "post_rectification" && !j.facts.installedAt) x.fixesFound = { at: String(r["created_at"]), stage: j.stage };
    }
  }
  // Jo 28 Oct (decision 158, OFFICE CHOOSES): a lapsed window with no office payer choice for that deadline → one Today row.
  const lapsedIds = [...facts.values()].filter((x) => x.lapsedWindow).map((x) => x.jobId);
  if (lapsedIds.length) {
    const ev = await byIds("repeat PIESA choices", lapsedIds, (chunk, a, b) => admin.from("workflow_events").select("job_id, event_type, details, created_at").in("job_id", chunk).in("event_type", ["repeat_piesa_payer_chosen", "install_window_expired", "xero_invoice_repeat_piesa_held", "xero_invoice_repeat_piesa_added"]).range(a, b));
    for (const id of lapsedIds) {
      const x = f(id)!; const dl = x.lapsedWindow!.deadline;
      const mine = ev.filter((e) => String(e["job_id"]) === id && String((e["details"] as { deadline?: string } | null)?.deadline) === dl);
      if (mine.some((e) => e["event_type"] === "repeat_piesa_payer_chosen")) {
        const line = mine.filter((e) => String(e["event_type"]).startsWith("xero_invoice_repeat_piesa_")).sort((a, b) => String(a["created_at"]).localeCompare(String(b["created_at"]))).at(-1);
        if (line?.["event_type"] === "xero_invoice_repeat_piesa_held") x.repeatXeroHeld = { at: String(line["created_at"]), reason: String((line["details"] as { reason?: string } | null)?.reason ?? "held") };
        continue;
      }
      const sp = String((mine.find((e) => e["event_type"] === "install_window_expired")?.["details"] as { payer?: string } | null)?.payer ?? "");
      x.repeatPiesaChoice = { deadline: dl, suggested: sp && sp !== "undetermined" ? sp : null };
    }
  }

  // Batch 1 task 6: a reopen's owner-pays repeat line held on Xero gets the same one Today row as a 30-day one.
  {
    const { reopenRepeatDeadlines, repeatXeroHeldFor } = await import("./repeat-piesa.core");
    const reopened = reopenRepeatDeadlines(payRepeatEv);
    const heldIds = [...reopened.keys()].filter((id) => { const x = f(id); return !!x && !x.repeatXeroHeld; });
    if (heldIds.length) {
      const ev = await byIds("repeat Xero lines", heldIds, (chunk, a, b) => admin.from("workflow_events").select("job_id, event_type, details, created_at").in("job_id", chunk).in("event_type", ["xero_invoice_repeat_piesa_held", "xero_invoice_repeat_piesa_added"]).range(a, b));
      for (const id of heldIds) {
        const held = repeatXeroHeldFor(ev.filter((e) => String(e["job_id"]) === id), reopened.get(id)!);
        if (held) f(id)!.repeatXeroHeld = held;
      }
    }
  }

  // Wave 2: follow-up reads keyed by what wave 1 found, all at once.
  type Guess = { job_id: string; job_number: string; why?: string[] };
  const guessOf = (u: Record<string, unknown>) => ((u["guesses"] as Guess[] | undefined) ?? [])[0] ?? null;
  const rIds = [...new Set(returned.map((r) => String(r["job_id"])).filter((id) => idSet.has(id)))];
  // Decision 271: Part A signs itself; the office sees a row only once the automatic signature has been held >24h, with the reasons.
  const partA = veecForms.filter((v) => v["installer_signed_at"] && !v["ap_signed_at"] && apAutoHoldAlert({ installerSignedAt: String(v["installer_signed_at"]), now, reasons: ["pending"] }).alert);
  const aIds = [...new Set(piisaAlerts.map((e) => String(e["job_id"])).filter((id) => idSet.has(id)))];
  const finalIds = [...facts.values()].filter((x) => x.finalCheck).map((x) => x.jobId);
  const askJobIds = [...new Set([...items.changes.map((c) => c.jobId as string | null), ...items.unmatched.map((u) => guessOf(u as Record<string, unknown>)?.job_id ?? null)].filter((x): x is string => !!x))];
  const fbIds = [...new Set(fb.map((e) => String(e["job_id"])))];
  // Decision 370: the consent's AP part signs itself; a row only once that has been held >24h (or the deadline is <24h away), with the reasons.
  const heldConsents = consents.filter((c) => f(String(c["job_id"])) && !["cancelled", "stale", "superseded"].includes(String(c["status"])) && consentApHoldAlert({ ownerSignedAt: s(c["owner_signed_at"]), scheduledStart: s(c["scheduled_start"]), now, reasons: ["pending"] }).alert);
  // Decision 389: release state for the "choose installer" jobs (pending → nothing for the office; lapsed → its one row).
  const releaseIds = [...facts.values()].filter((x) => x.spotSaved).map((x) => x.jobId);
  // Jo 28 Oct 2026 ("Alert after 3 days unpaid"): follow-up reads keyed by wave 1 — the PIESA quote lines, the
  // deposit-gate overrides and the stage entry that started each install-deposit wait.
  const payQuoteIds = payQuotes.filter((x) => x["kind"] === "installation").map((x) => String(x["id"]));
  const payInvIds = payInvoices.map((x) => String(x["id"]));
  const depositJobIds = jobs.filter((j) => INSTALL_DEPOSIT_DUE_STAGES.has(j.stage)).map((j) => j.id);
  const [later, partAReasons, consentReasonList, made, payViews, finalFlags, askRows, fbRows, releases, payPiesaLines, payOverrides, payStageEv] = await Promise.all([
    rIds.length ? byIds("offers after return", rIds, (chunk, a, b) => admin.from("partner_offers").select("job_id, kind, offered_at").in("job_id", chunk).range(a, b)) : Promise.resolve([] as Row[]),
    partA.length && partA.length <= 40
      ? import("./veec-ap-auto.server").then(({ apAutoHoldReasons }) => Promise.all(partA.map(async (v) => (f(String(v["job_id"])) ? await apAutoHoldReasons(String(v["job_id"])).catch(() => ["Prerequisites could not be read."]) : null))))
      : Promise.resolve(null),
    heldConsents.length && heldConsents.length <= 40
      ? import("./consent-ap-auto.server").then(({ consentApHoldReasons }) => Promise.all(heldConsents.map(async (c) => [String(c["job_id"]), await consentApHoldReasons(String(c["job_id"])).catch(() => ["The consent checks could not be read."])] as const)))
      : Promise.resolve([] as (readonly [string, string[]])[]),
    aIds.length ? byIds("install day forms created", aIds, (chunk, a, b) => admin.from("workflow_events").select("job_id, event_type, created_at").in("job_id", chunk).eq("event_type", PIISA_AUDIT_CREATED_EVENT).range(a, b)) : Promise.resolve([] as Row[]),
    // Install deposit (10%) not in Xero while the 48h provisional hold runs (decisions 139/240): watch only.
    provisionalBookings.length && provisionalBookings.length <= 40
      ? import("./payments.server").then(({ jobPaymentView }) => Promise.all(provisionalBookings.map((b) => (f(String(b["job_id"])) ? jobPaymentView(String(b["job_id"]), new Date(now)).catch(() => { if (!unavailable.includes("install deposits")) unavailable.push("install deposits"); return null; }) : Promise.resolve(null)))))
      : Promise.resolve(null),
    finalIds.length ? byIds("final check flags", finalIds, (chunk, a, b) => admin.from("compliance_checks").select("job_id, status").in("job_id", chunk).eq("status", "fail").range(a, b)) : Promise.resolve([] as Row[]),
    askJobIds.length ? byIds("email ask jobs", askJobIds, (chunk, a, b) => admin.from("jobs").select("id, job_number, source, owners(full_name), properties(suburb)").in("id", chunk).range(a, b)) : Promise.resolve([] as Row[]),
    fbIds.length ? byIds("review feedback jobs", fbIds, (chunk, a, b) => admin.from("jobs").select("id, job_number, source, owners(full_name)").in("id", chunk).range(a, b)) : Promise.resolve([] as Row[]),
    releaseIds.length ? import("./spot-release.server").then((m) => m.spotReleaseStates(releaseIds)) : Promise.resolve(new Map()),
    payQuoteIds.length ? byIds("PIESA lines for unpaid payments", payQuoteIds, (chunk, a, b) => admin.from("quote_items").select("quote_id, line_total_inc_gst").in("quote_id", chunk).eq("code", "PIESA").range(a, b)) : Promise.resolve([] as Row[]),
    payInvIds.length ? byIds("deposit overrides", payInvIds, (chunk, a, b) => admin.from("payment_overrides").select("invoice_id").in("invoice_id", chunk).eq("gate", "deposit").range(a, b)) : Promise.resolve([] as Row[]),
    depositJobIds.length ? byIds("deposit stage entries", depositJobIds, (chunk, a, b) => admin.from("workflow_events").select("job_id, created_at").in("job_id", chunk).eq("event_type", "stage_changed").in("to_stage", [...INSTALL_DEPOSIT_DUE_STAGES] as ("piesa_complete" | "installation_scheduling" | "installation_booked")[]).order("created_at", { ascending: false }).range(a, b)) : Promise.resolve([] as Row[]),
  ]);
  {
    const { officeItemWithRelease } = await import("./spot-release.core");
    for (const id of releaseIds) {
      const x = f(id); if (!x) continue;
      const item = officeItemWithRelease({ code: "choose_installer" as const }, releases.get(id));
      if (!item) delete x.spotSaved;
      else if (item.code === "release_lapsed") { delete x.spotSaved; x.releaseLapsed = { at: item.at, name: item.name }; }
    }
  }

  for (const qd of rectDrafts) {
    const x = f(String(qd["job_id"])); if (!x) continue;
    const h = rectHolds.find((e) => e["job_id"] === qd["job_id"] && (e["details"] as { quote_id?: string } | null)?.quote_id === qd["id"]);
    if (h) x.fixesQuoteToCheck = { at: String(h["created_at"]), reason: s((h["details"] as { reason?: string } | null)?.reason) };
  }
  for (const r of [...q.rows, ...(qTest?.rows ?? [])]) { const x = f(r.jobId); if (x) x.quoteToCheck = { at: r.at, reason: r.kind === "ready" ? null : r.note, ready: r.kind === "ready" }; }
  for (const r of [...q.declined, ...(qTest?.declined ?? [])]) { const x = f(r.jobId); if (x && !x.quoteToCheck) x.quoteToCheck = { at: r.at, reason: `owner declined${r.reason ? ` (“${r.reason}”)` : ""} · reopen or close`, ready: false }; }

  for (const r of returned) {
    const x = f(String(r["job_id"])); if (!x || x.offerLapsed) continue;
    const kind = String((r["details"] as { kind?: string } | null)?.kind ?? "ready_check");
    // Cleared as soon as a new offer of that kind goes out after the hand-back.
    if (later.some((o) => o["job_id"] === r["job_id"] && o["kind"] === kind && String(o["offered_at"]) > String(r["created_at"]))) continue;
    x.offerLapsed = { role: kind === "piesa" ? "electrician" : "installer", name: null, declined: false, at: String(r["created_at"]), note: String(r["summary"] ?? "") };
    if (kind === "ready_check") delete x.spotSaved; else delete x.electricianToChoose;
  }
  const consentReasons = new Map<string, string[]>(consentReasonList);
  for (const c of heldConsents) {
    const x = f(String(c["job_id"])); if (!x) continue;
    const reasons = heldConsents.length <= 40 ? consentReasons.get(String(c["job_id"])) ?? [] : ["The AP part has not signed itself yet (open the job)."];
    if (!reasons.length) continue; // nothing holds it — the next tick signs it
    const start = s(c["scheduled_start"]);
    x.consentToSign = { at: String(c["owner_signed_at"]), dueAt: start ? new Date(Date.parse(start) - DAY).toISOString() : null, reasons };
  }
  if (partAReasons) partA.forEach((v, i) => { const x = f(String(v["job_id"])); const reasons = partAReasons[i]; if (x && reasons?.length) x.veecApHeld = { at: String(v["installer_signed_at"]), reasons }; });
  else for (const v of partA) { const x = f(String(v["job_id"])); if (x) x.veecApHeld = { at: String(v["installer_signed_at"]), reasons: ["Prerequisites still to record (open the job)."] }; }
  for (const e of escRows) {
    const x = f(String(e["job_id"])); if (!x || ["cancelled", "withdrawn", "superseded", "stale"].includes(String(e["status"]))) continue;
    const opens = s(e["earliest_send_at"]);
    if (opens && Date.parse(opens) > now) continue; // window not open yet — the robot submits inside it
    x.escWindow = { closesAt: String(e["due_by"]), opensAt: opens };
  }
  for (const r of sendFailedRows({ now, emails: emailFails.map((e) => ({ job_id: String(e["job_id"]), purpose: String(e["purpose"]), status: String(e["status"]), created_at: String(e["created_at"]), error: s(e["error"]) })), sms: smsFails.map((m) => ({ job_id: s(m["job_id"]), message_type: String(m["message_type"]), status: String(m["status"]), created_at: String(m["created_at"]), detail: s(m["detail"]) })) })) {
    const x = f(r.jobId); if (x) x.sendFailed = { at: r.latestAt, text: r.text };
  }
  for (const r of await unknownSendsP) { const x = f(r.jobId); if (x && !x.sendUnknown) x.sendUnknown = { at: r.at, text: r.text }; }
  for (const r of robotRows) { const x = f(r.jobId); if (x && !x.robotFailed) x.robotFailed = { at: r.at, text: r.text, task: r.task }; }
  for (const id of aIds) {
    const j = jobById.get(id); const x = f(id);
    if (!x || j?.stage !== "installation_booked") continue;
    const open = piisaFormFailedOpen([...piisaAlerts, ...made].filter((e) => e["job_id"] === id).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as { message?: string | null } | null })));
    if (open) x.piisaFormFailed = open;
  }
  // Decision 395: a failed day-before pre-start check for the CURRENT install booking → one row with what is missing.
  for (const [id, r] of prestartFailedFor(upcomingInstalls.map((b) => ({ job_id: String(b["job_id"]), scheduled_start: String(b["scheduled_start"]) })),
    prestartChecks.map((c) => ({ job_id: String(c["job_id"]), scheduled_start: String(c["scheduled_start"]), passed: c["passed"] === true, failures: (c["failures"] as string[] | null) ?? [], checked_at: String(c["checked_at"]) })))) {
    const x = f(id); if (x) x.prestartFailed = r;
  }
  // Decision 398: the automatic A3 PIESA form failed → one row until the job has its PIESA form (office button = backup).
  {
    const failIds = [...new Set(piesaFormFails.map((e) => String(e["job_id"])).filter((id) => idSet.has(id)))];
    const withForm = new Set((failIds.length ? await byIds("PIESA forms", failIds, (chunk, a, b) => admin.from("assessments").select("job_id").in("job_id", chunk).not("external_mitti_id", "is", null).range(a, b)) : []).map((r) => String(r["job_id"])));
    for (const id of failIds) {
      const x = f(id); if (!x) continue;
      const open = piesaFormFailedOpen({ events: piesaFormFails.filter((e) => e["job_id"] === id).map((e) => ({ created_at: String(e["created_at"]), details: (e["details"] ?? null) as { reason?: string | null } | null })), hasPiesaForm: withForm.has(id), stage: jobById.get(id)?.stage ?? null });
      if (open) x.piesaFormFailed = open;
    }
  }
  for (const t of tenDay) { const x = f(String(t["id"])); if (x) x.tenDaysLeft = { at: String(t["install_10day_flagged_at"]), deadline: jobById.get(String(t["id"]))?.facts.installDeadline ?? null }; }
  for (const e of noAccess) { const x = f(String(e["job_id"])); const j = jobById.get(String(e["job_id"])); if (x && !x.secondNoAccess && j?.stage === "installation_scheduling") x.secondNoAccess = { at: String(e["created_at"]), reason: s((e["details"] as { reason?: string } | null)?.reason) }; }
  // Decision 296: the alert names its PIESA record; a confirmation of that record (or the install already booked) clears the row.
  const confirmedRecords = new Set(piesaConfirms.map((c) => `${c["job_id"]}:${(c["details"] as { piesa_record_id?: string } | null)?.piesa_record_id ?? ""}`));
  for (const e of piesaAlerts) {
    const id = String(e["job_id"]), rec = (e["details"] as { piesa_record_id?: string; completed_date?: string } | null) ?? null;
    const x = f(id); const j = jobById.get(id);
    if (!x || !j || !["piesa_complete", "electrical_variation_pending", "awaiting_deposit_payment", "rectification_scheduling", "rectification_booked", "installation_scheduling"].includes(j.stage)) continue;
    if (confirmedRecords.has(`${id}:${rec?.piesa_record_id ?? ""}`)) continue;
    if (!x.piesaOwnerUnsigned || String(e["created_at"]) > x.piesaOwnerUnsigned.at) x.piesaOwnerUnsigned = { at: String(e["created_at"]), completedDate: s(rec?.completed_date) };
  }
  // Decision 330: the alert names its fixes record; a confirmation of that record clears the row (closed jobs never show).
  const fixesConfirmed = new Set(fixesConfirms.map((c) => `${c["job_id"]}:${(c["details"] as { piesa_record_id?: string } | null)?.piesa_record_id ?? ""}`));
  for (const e of fixesAlerts) {
    const id = String(e["job_id"]), rec = (e["details"] as { piesa_record_id?: string; fixes_date?: string } | null) ?? null;
    const x = f(id); const j = jobById.get(id);
    if (!x || !j || ["complete", "cancelled"].includes(j.stage)) continue;
    if (fixesConfirmed.has(`${id}:${rec?.piesa_record_id ?? ""}`)) continue;
    if (!x.fixesOwnerUnsigned || String(e["created_at"]) > x.fixesOwnerUnsigned.at) x.fixesOwnerUnsigned = { at: String(e["created_at"]), fixesDate: s(rec?.fixes_date) };
  }
  // Hard stop: current eligibility result "needs review" (missing/conflicting evidence) → one row until a new result replaces it.
  try {
    const elig = await all("eligibility reviews", (a, b) => { const q = (admin as unknown as { from: (t: string) => { select: (c: string) => { eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => { in: (c: string, v: string[]) => never; range: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }> } } } } }).from("eligibility_verifications").select("*").eq("is_current", true).eq("outcome", "needs_review"); return (opts.onlyIds ? (q as unknown as { in: (c: string, v: string[]) => typeof q }).in("job_id", opts.onlyIds) : q).range(a, b); });
    for (const e of elig) { const x = f(String(e["job_id"])); if (x) x.eligibilityReview = { at: String(e["created_at"]), reason: s(e["note"]) ?? s(e["reason"]) }; }
  } catch { unavailable.push("eligibility reviews"); }
  // Hard stop: a refused Mitti form (wrong job number / wrong form) → one row until a good sync clears the error.
  try {
    const mf = await all("Mitti form problems", (a, b) => scoped(admin.from("assessments").select("job_id, mitti_last_error, updated_at")).eq("mitti_sync_status", "error").not("mitti_last_error", "is", null).neq("status", "complete").range(a, b));
    for (const r of mf) { const x = f(String(r["job_id"])); if (x && !x.mittiFormProblem) x.mittiFormProblem = { at: String(r["updated_at"]), error: String(r["mitti_last_error"]) }; }
  } catch { unavailable.push("Mitti form problems"); }
  // Hard stop: a reversed owner payment with nothing paid since → one Money row until a new payment is recorded.
  try {
    const { openPaymentReversal } = await import("./office-needs.core");
    const rev = await all("payment reversals", (a, b) => scoped(admin.from("workflow_events").select("job_id")).eq("event_type", "owner_payment_reversed").range(a, b));
    const revIds = [...new Set(rev.map((e) => String(e["job_id"])).filter((id) => idSet.has(id)))];
    if (revIds.length) {
      const pe = await byIds("payment history", revIds, (c, a, b) => admin.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", ["owner_payment_recorded", "owner_payment_reversed"]).range(a, b));
      for (const id of revIds) {
        const open = openPaymentReversal(pe.filter((e) => e["job_id"] === id).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), amount_cents: Number((e["details"] as { amount_cents?: number } | null)?.amount_cents ?? 0) })));
        const x = f(id); if (x && open) x.paymentReversed = open;
      }
    }
  } catch { unavailable.push("payment reversals"); }
  // Batch 2: a STOP reply cancelled the job but releasing the installer failed → one row until `job_cancel_released` is written
  // (the tick retries). The job is usually already cancelled, so its facts are made here when the open-jobs read dropped it.
  try {
    const { stopReleaseNeeds } = await import("./stop-release.server");
    for (const n of await stopReleaseNeeds(admin, { includeTest: opts.includeTest, ...(opts.onlyIds ? { onlyIds: opts.onlyIds } : {}) })) {
      const x = f(n.jobId) ?? { jobId: n.jobId, jobNumber: n.jobNumber, surname: n.surname, suburb: n.suburb, ...(n.isTest ? { isTest: true } : {}) };
      x.stopReleaseFailed = { at: n.at };
      facts.set(n.jobId, x);
    }
  } catch { unavailable.push("STOP clean-up failures"); }
  /** Batch 3a: the open jobs among `ids`, plus jobs still closed by an expired quote (their facts are made here). */
  const withExpiryClosedJobs = async (ids: string[]) => {
    const extra = ids.filter((id) => !facts.has(id));
    for (const [id, x] of await expiryClosedJobFacts(extra, opts.includeTest)) facts.set(id, x);
    return ids.filter((id) => facts.has(id));
  };
  // Batch 3a: an expired quote could not close the job because the owner can't be emailed → one row until the close completes.
  try {
    const { quoteExpiredBlockedFact } = await import("./office-needs.core");
    const raised = await all("expired quotes not emailable", (a, b) => scoped(admin.from("workflow_events").select("job_id")).eq("event_type", "quote_expired_not_emailable").range(a, b));
    const raisedIds = await withExpiryClosedJobs([...new Set(raised.map((e) => String(e["job_id"])))]);
    if (raisedIds.length) {
      const ev = await byIds("expired quote history", raisedIds, (c, a, b) => admin.from("workflow_events").select("job_id, event_type, created_at, details").in("job_id", c).in("event_type", ["quote_expired_not_emailable", "quote_expired_closed"]).range(a, b));
      const live = await byIds("open quotes of expired-quote jobs", raisedIds, (c, a, b) => admin.from("quotes").select("job_id").in("job_id", c).eq("kind", "installation").in("status", ["issued", "accepted"]).range(a, b));
      const liveIds = new Set(live.map((r) => String(r["job_id"])));
      for (const id of raisedIds) {
        if (liveIds.has(id)) continue; // a newer quote is out or accepted: nothing to chase
        const hit = quoteExpiredBlockedFact(ev.filter((e) => e["job_id"] === id).map((e) => ({ event_type: String(e["event_type"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as Record<string, unknown> | null })));
        const x = f(id); if (x && hit) x.quoteExpiredBlocked = hit;
      }
    }
  } catch { unavailable.push("expired quotes not emailable"); }
  // Batch 3a: the owner asked for a new quote but the installer could not be put back, or the reopen half-finished →
  // one row until an installation quote is created after it.
  try {
    const { NEW_QUOTE_NEEDS_INSTALLER_EVENT, NEW_QUOTE_UNFINISHED_EVENT } = await import("./new-quote-request.core");
    const raised = await all("new quotes needing the office", (a, b) => scoped(admin.from("workflow_events").select("job_id")).in("event_type", [NEW_QUOTE_NEEDS_INSTALLER_EVENT, NEW_QUOTE_UNFINISHED_EVENT]).range(a, b));
    const raisedIds = await withExpiryClosedJobs([...new Set(raised.map((e) => String(e["job_id"])))]);
    for (const [id, hit] of await newQuoteOfficeFacts(raisedIds)) { const x = f(id); if (x) x.newQuoteOffice = hit; }
  } catch { unavailable.push("new quotes needing the office"); }
  // Batch 1: the owner accepted but the invoice step failed → one Money row until a Xero-linked invoice exists.
  try {
    const { invoiceFailedFact } = await import("./office-needs.core");
    const fails = await all("failed invoices", (a, b) => scoped(admin.from("workflow_events").select("job_id, summary, created_at")).eq("event_type", "invoice_create_failed").range(a, b));
    const failIds = [...new Set(fails.map((e) => String(e["job_id"])).filter((id) => idSet.has(id)))];
    if (failIds.length) {
      const acc = await byIds("accepted quotes of failed jobs", failIds, (c, a, b) => admin.from("quotes").select("job_id").in("job_id", c).eq("kind", "installation").eq("status", "accepted").range(a, b));
      const accepted = new Set(acc.map((r) => String(r["job_id"])));
      const invs = await byIds("invoices of failed jobs", failIds, (c, a, b) => admin.from("invoices").select("job_id, xero_invoice_id, last_synced_at, created_at, last_sync_error, status").in("job_id", c).eq("kind", "installation").range(a, b));
      for (const id of failIds) {
        const hit = invoiceFailedFact(
          fails.filter((e) => String(e["job_id"]) === id).map((e) => ({ at: String(e["created_at"]), text: String(e["summary"] ?? "") })),
          invs.filter((i) => String(i["job_id"]) === id).map((i) => ({ xero_invoice_id: s(i["xero_invoice_id"]), last_synced_at: s(i["last_synced_at"]), created_at: String(i["created_at"]), last_sync_error: s(i["last_sync_error"]), status: s(i["status"]) })),
        );
        const x = f(id); if (x && hit && accepted.has(id)) x.invoiceFailed = hit;
      }
    }
  } catch { unavailable.push("failed invoices"); }
  // Decision 315: 24h after the fixes-times link with no times → one "Electrician hasn't given fixes times" row.
  for (const [id, r] of fixesTimesMissing({ links: fixesLinks.map((e) => ({ job_id: String(e["job_id"]), created_at: String(e["created_at"]) })), given: fixesGiven.map((e) => ({ job_id: String(e["job_id"]), created_at: String(e["created_at"]) })), now })) {
    const x = f(id); if (x) x.fixesTimesMissing = { at: r.at };
  }
  const unsigned = new Set(veecForms.filter((v) => !v["consumer_signed_at"]).map((v) => String(v["job_id"])));
  for (const e of veecAlerts) { const x = f(String(e["job_id"])); if (x && unsigned.has(String(e["job_id"]))) x.veecDay10 = { at: String(e["created_at"]) }; }
  // Jo 28 Oct 2026 (decision card 04:40 UTC, "Alert after 3 days unpaid"): a job paused on a homeowner payment that
  // stays unpaid for 3 full days raises ONE Needs me row naming the payment and since when (payment-stall.core).
  // The row is derived from the paid amount, never stored — recording the payment clears it by itself. Covered: the
  // $349 safety check, the fixes, the 10% install deposit and the repeat safety check (the balance is not — Jo's list).
  {
    const { paymentStall } = await import("./payment-stall.core");
    const { safetyCheckCentsFor } = await import("./safety-check-amount.core");
    const { REPEAT_PIESA_ACCEPTED_EVENT, REPEAT_PIESA_PAID_EVENT } = await import("./repeat-piesa.core");
    const invoiceByJob = new Map<string, Row>();
    for (const r of payInvoices) { const id = String(r["job_id"]); const cur = invoiceByJob.get(id); if (!cur || String(r["created_at"]) > String(cur["created_at"])) invoiceByJob.set(id, r); }
    const quotesByJob = new Map<string, Row[]>();
    for (const q of payQuotes) { const id = String(q["job_id"]); const list = quotesByJob.get(id); if (list) list.push(q); else quotesByJob.set(id, [q]); }
    const piesaLinesByQuote = new Map<string, { code: string | null; line_total_inc_gst: number | string | null }[]>();
    for (const it of payPiesaLines) { const qid = String(it["quote_id"]); const list = piesaLinesByQuote.get(qid); const line = { code: "PIESA", line_total_inc_gst: it["line_total_inc_gst"] as number | null }; if (list) list.push(line); else piesaLinesByQuote.set(qid, [line]); }
    const waivedInvoices = new Set(payOverrides.map((o) => String(o["invoice_id"])));
    const piesaByJob = new Map(piesaCurRows.map((p) => [String(p["job_id"]), p]));
    // payStageEv is newest-first: the first row per job is the latest entry into a deposit-due stage.
    const depositSinceByJob = new Map<string, string>();
    for (const e of payStageEv) { const id = String(e["job_id"]); if (!depositSinceByJob.has(id)) depositSinceByJob.set(id, String(e["created_at"])); }
    const repeatByJob = new Map<string, { deadline: string; price: number; acceptedAt: string | null; paid: boolean; paidBeforeCents: number | null }>();
    const evDeadline = (e: Row) => String((e["details"] as { deadline?: unknown } | null)?.deadline ?? "");
    // The newest office choice decides the deadline and the price (installer/HIVIC newest → price 0).
    for (const e of payRepeatEv) { // newest-first
      const id = String(e["job_id"]);
      if (String(e["event_type"]) !== "repeat_piesa_payer_chosen" || repeatByJob.has(id)) continue;
      const d = e["details"] as { payer?: string; price_inc_gst?: number | null } | null;
      repeatByJob.set(id, { deadline: evDeadline(e), price: d?.payer === "owner" ? Number(d?.price_inc_gst ?? 0) : 0, acceptedAt: null, paid: false, paidBeforeCents: null });
    }
    // Only acceptance/payment for that same deadline counts.
    for (const e of payRepeatEv) { // newest-first
      const cur = repeatByJob.get(String(e["job_id"])); const t = String(e["event_type"]);
      if (!cur || evDeadline(e) !== cur.deadline) continue;
      if (t === REPEAT_PIESA_ACCEPTED_EVENT && !cur.acceptedAt) { cur.acceptedAt = String(e["created_at"]); const pb = (e["details"] as { paid_before_cents?: unknown } | null)?.paid_before_cents; cur.paidBeforeCents = typeof pb === "number" && Number.isFinite(pb) ? pb : null; }
      else if (t === REPEAT_PIESA_PAID_EVENT) cur.paid = true;
    }
    for (const [id, inv] of invoiceByJob) {
      const x = f(id); const j = jobById.get(id);
      if (!x || !j || ["complete", "cancelled", "on_hold"].includes(j.stage)) continue;
      const qs = quotesByJob.get(id) ?? [];
      const byAccepted = (k: string) => qs.filter((q) => q["kind"] === k && q["accepted_at"]).sort((a, b) => String(b["accepted_at"]).localeCompare(String(a["accepted_at"])))[0];
      const installQ = byAccepted("installation");
      if (!installQ) continue;
      const rectQ = byAccepted("rectification");
      const installAccepted = String(installQ["accepted_at"]);
      const paidCents = toCents(inv["total_paid"] as number | null);
      const safety = safetyCheckCentsFor({ lines: piesaLinesByQuote.get(String(installQ["id"])) ?? [], settingIncGst: (paySettings?.["safety_check_payment_inc_gst"] ?? null) as number | null }).cents;
      const fixesCents = fixesCountedCents({ rectTotalCents: toCents(rectQ?.["customer_total_inc_gst"] as number | null), rectAcceptedAt: rectQ ? String(rectQ["accepted_at"]) : null, installAcceptedAt: installAccepted });
      const rep = repeatByJob.get(id);
      const repeatCents = rep && rep.price > 0 && rep.acceptedAt ? toCents(rep.price) : 0;
      const credit = repeatCreditCents({ repeatCents, paidCents, paidBeforeAcceptCents: rep?.paidBeforeCents ?? null, recordedPaid: !!rep?.paid });
      const own = paidCents - credit; // the repeat's money never counts toward the other steps
      const plan = paymentPlan({ quoteTotalCents: toCents(installQ["customer_total_inc_gst"] as number | null), safetyCheckCents: safety, fixesCents, repeatCents });
      const steps: { key: PaymentStepKey; since: string }[] = [];
      if (!waivedInvoices.has(String(inv["id"])) && own < plan.thresholds.safety_check) steps.push({ key: "safety_check", since: installAccepted });
      if (fixesCents > 0 && rectQ && own < plan.thresholds.fixes) steps.push({ key: "fixes", since: String(rectQ["accepted_at"]) });
      const depSince = depositSinceByJob.get(id);
      if (depSince && INSTALL_DEPOSIT_DUE_STAGES.has(j.stage) && installDepositDueNow(j.stage, piesaByJob.get(id) as { outcome?: string | null; section_c_signed_at?: string | null } | null) && own < plan.thresholds.install_deposit) steps.push({ key: "install_deposit", since: depSince });
      if (repeatCents > 0 && rep?.acceptedAt && !rep.paid && repeatCents - credit > 0) steps.push({ key: "repeat_safety_check", since: rep.acceptedAt });
      const stall = paymentStall(steps, now);
      if (stall) x.paymentStalled = stall;
    }
  }
  for (const i of overdue) { const x = f(String(i["job_id"])); if (x) x.paymentOverdue = { at: String(i["balance_due_date"] ?? i["deposit_due_date"] ?? new Date(now).toISOString()), text: `$${Math.max(0, Number(i["total_inc_gst"] ?? 0) - Number(i["total_paid"] ?? 0)).toLocaleString("en-AU", { maximumFractionDigits: 0 })} owing` }; }
  if (payViews) provisionalBookings.forEach((b, i) => {
    const x = f(String(b["job_id"])); const v = payViews[i];
    if (!x || v?.provisional.decision !== "provisional") return;
    const dep = v.steps.find((st) => st.key === "install_deposit");
    x.paymentNotInXero = { at: String(b["created_at"]), text: `Deposit $${((dep?.amountCents ?? 0) / 100).toLocaleString("en-AU", { maximumFractionDigits: 0 })}${v.provisional.expiresAt ? ` · hold ends ${new Date(v.provisional.expiresAt).toLocaleString("en-AU", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Australia/Melbourne" })}` : ""}` };
  });
  // Final check flags: failed compliance checks on jobs at Final check.
  for (const c of finalFlags) { const x = f(String(c["job_id"])); if (x?.finalCheck) x.finalCheck.flags++; }

  // Email rows (decisions 245/247). Renders nothing when there are none.
  const askJobs = new Map<string, { jobNumber: string; surname: string; suburb: string | null; source: string | null }>();
  for (const r of askRows)
    askJobs.set(String(r["id"]), { jobNumber: String(r["job_number"]), surname: surnameOf((r["owners"] as { full_name?: string } | null)?.full_name), suburb: (r["properties"] as { suburb?: string } | null)?.suburb ?? null, source: s(r["source"]) });
  const wantJob = (id: string | null) => !opts.onlyIds || (id != null && idSet.has(id));
  const emails: EmailRowInput[] = [];
  // Jo 27 Oct 2026 (decision 414): owner emails moved to the office Emails tab (emails-tab.server) — not listed here.
  for (const c of [] as unknown as { eventId: string; jobId: string; at: string; intent?: string; phrase?: string }[]) {
    const j = askJobs.get(c.jobId);
    if (!wantJob(c.jobId) || (!opts.includeTest && j?.source === "qa_test")) continue;
    const line = CHANGE_LINE[(c.intent ?? "other") as keyof typeof CHANGE_LINE] ?? CHANGE_LINE.other;
    emails.push({ type: "change", eventId: c.eventId, jobId: c.jobId, jobNumber: j?.jobNumber ?? null, surname: j?.surname ?? "", suburb: j?.suburb ?? null, line: `${line}${c.phrase ? ` · “${c.phrase}”` : ""}`, at: c.at, intent: c.intent ?? null });
  }
  // Jo 26 Oct 2026: unmatched emails moved to Enquiries ("Emails to match", email-unmatched-rows.server) — not listed here.
  for (const u of [] as ({ eventId: string; at: string; from?: string | null; subject?: string | null } & Record<string, unknown>)[]) {
    const g = guessOf(u);
    if (!wantJob(g?.job_id ?? null)) continue;
    const j = g ? askJobs.get(g.job_id) : undefined;
    emails.push({ type: "unmatched", eventId: u.eventId, guessJobId: g?.job_id ?? null, guessWhy: g?.why ?? [], jobNumber: j?.jobNumber ?? g?.job_number ?? null, surname: j?.surname ?? "", suburb: j?.suburb ?? null,
      line: `Email from ${u.from ?? "an unknown sender"}${u.subject ? ` · “${String(u.subject).slice(0, 60)}”` : ""}${g ? ` · best guess ${g.job_number}${g.why?.length ? ` (${g.why[0]})` : ""}` : " · no guess"}`, at: u.at });
  }

  // Partner & system fold (decision 221): partner items from the office rulebook + per-job system failures + quotes not drafted.
  const system: SystemRow[] = [];
  if (listMode) {
    for (const p of office.needs.items.filter((i) => i.rule === "j_partner")) system.push({ key: p.key, tag: /application/i.test(p.what) ? "Application" : /worker|staff/i.test(p.what) ? "Person" : /form/i.test(p.what) ? "Mitti" : "Partner", who: p.what, line: p.why, since: p.dueAt, button: "Review", href: p.href ?? "/admin/partners" });
    for (const j of jobs) for (const why of j.needs.failures) if (!/^(Email|Text) /.test(why) && !duplicatesInvoiceFailed(why, facts.get(j.id)?.invoiceFailed)) system.push({ key: `fail:${j.id}:${why}`, tag: "System", who: `${j.jobNumber} ${surnameOf(j.owner)}`.trim(), line: why, since: null, button: "Open job", href: `/admin/jobs/${j.id}`, jobId: j.id });
    // Decision 303: "<REC> onboarded and linked to <installer> — n quote(s) ready to check" (or the conflict the office decides).
    for (const r of recLinks) system.push({ key: r.key, tag: "Partner", who: r.recName, line: r.line, since: r.since, button: r.conflict ? "Decide" : "Quotes to check", href: r.conflict ? "/admin/partners" : "/admin/quotes" });
    // Batch 2: texts to a trade with no job (e.g. a job offer) that failed or may not have arrived — one row per business, named.
    {
      // Job-less daily trade texts already have their own "Daily text to … failed" row (office.server, open trade_text_log
      // failures): don't show the same failure twice (same business + type).
      const tradeLog = smsFails.some((m) => !m["job_id"] && /^daily_mitti/.test(String(m["message_type"])))
        ? await all("trade text failures", (a, b) => (admin as unknown as { from: (t: string) => any }).from("trade_text_log").select("business_id, kind").eq("status", "failed").is("acknowledged_at", null).range(a, b)) // eslint-disable-line @typescript-eslint/no-explicit-any
        : [];
      const covered = tradeTextCoveredKeys(tradeLog.map((r: Row) => ({ business_id: s(r["business_id"]), kind: s(r["kind"]) })));
      const pr = partnerSendFailedRows({ now, covered, sms: smsFails.map((m) => ({ job_id: s(m["job_id"]), business_id: s(m["business_id"]), message_type: String(m["message_type"]), status: String(m["status"]), created_at: String(m["created_at"]), detail: s(m["detail"]) })) });
      const names = new Map((pr.length ? await byIds("partner text businesses", pr.map((r) => r.businessId), (chunk, a, b) => admin.from("businesses").select("id, name").in("id", chunk).range(a, b)) : []).map((b) => [String(b["id"]), s(b["name"])]));
      for (const r of pr) system.push({ key: `partner-send:${r.businessId}`, tag: "Partner", who: names.get(r.businessId) ?? "A trade business", line: `Send failed · ${r.text}`, since: r.latestAt, button: "Open", href: `/admin/partners/business/${r.businessId}` });
    }
    for (const r of [...q.notDrafted, ...(qTest?.notDrafted ?? [])]) if (idSet.has(r.jobId)) system.push({ key: `nodraft:${r.jobId}`, tag: "Quote", who: `${r.jobNumber} ${surnameOf(r.owner)}`.trim(), line: `Quote not drafted yet · ${r.note}`, since: r.at, button: "Open job", href: `/admin/jobs/${r.jobId}`, jobId: r.jobId });
    if (fb.length) {
      const fbJobs = new Map<string, { jobNumber: string; surname: string; isTest?: boolean }>();
      for (const r of fbRows) fbJobs.set(String(r["id"]), { jobNumber: String(r["job_number"]), surname: surnameOf((r["owners"] as { full_name?: string } | null)?.full_name), ...(r["source"] === "qa_test" ? { isTest: true } : {}) });
      system.push(...reviewFeedbackRows(fb.map((e) => ({ job_id: String(e["job_id"]), created_at: String(e["created_at"]), details: (e["details"] ?? null) as { stars?: number; feedback?: string } | null })), fbJobs, now, opts.includeTest));
    }
  }
  return { now, jobs, facts, emails, system, unavailable };
}

/** `unavailable` is optional only because older saved copies (decision 382) were made before it existed. */
export type NeedsMePage = { now: number; groups: Record<"today" | "week" | "watch", NeedsRow[]>; system: SystemRow[]; total: number; unavailable?: string[] };

export async function loadNeedsMePage(includeTest: boolean, testJobIds?: string[]): Promise<NeedsMePage> {
  const g = await gatherNeedsFacts({ includeTest, ...(testJobIds ? { onlyIds: testJobIds, testOffice: true } : {}) });
  const groups = buildNeedsRows({ now: g.now, jobs: [...g.facts.values()], emails: g.emails });
  return { now: g.now, groups, system: g.system, total: groups.today.length + groups.week.length + groups.watch.length, unavailable: g.unavailable };
}
