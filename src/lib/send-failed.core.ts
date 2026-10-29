// "Send failed" rows for Needs me (decision 238 follow-up work). PURE: turns failed customer email sends and failed
// texts from the last 7 days into one row per job with plain text the office can act on. No I/O; the caller reads
// customer_email_sends / sms_messages and feeds the rows in. Nothing here resends anything.

export const SEND_FAILED_WINDOW_DAYS = 7;
const DAY = 86_400_000;

/** customer_email_sends statuses that are a confirmed failure (not "sending", not "delivered_unrecorded"). */
export const FAILED_EMAIL_STATUSES = ["failed"] as const;
/** sms_messages statuses that mean the text did not reach the phone (our "failed" plus Twilio's "undelivered"). */
export const FAILED_SMS_STATUSES = ["failed", "undelivered"] as const;
/** A later send of the same kind with one of these statuses means the failure was fixed (Jo 28 Oct 2026). Texts count only once delivered. */
export const SUCCESS_EMAIL_STATUSES = ["sent"] as const;
/** Batch 2: sends we are not sure arrived. Texts: `sent_unknown`. Emails: `delivered_unrecorded`, or `sending` for over an hour (stuck). Quiet-hours `blocked` holds are NOT here. */
export const UNSURE_EMAIL_STATUSES = ["delivered_unrecorded", "sending"] as const;
export const UNSURE_SMS_STATUSES = ["sent_unknown"] as const;
/** An email still "sending" after this long is treated as not sure it arrived. */
export const STUCK_SENDING_MS = 60 * 60 * 1000;
export const SUCCESS_SMS_STATUSES = ["delivered"] as const;

export type FailedEmailSend = { job_id: string; purpose: string; status: string; created_at: string; error: string | null };
export type FailedSms = { job_id: string | null; message_type: string; status: string; created_at: string; detail: string | null; business_id?: string | null };

export type SendFailedRow = {
  jobId: string;
  /** "Email failed: Save my spot email, 2 days ago — Resend: invalid address" (newest failure first, up to 3). */
  text: string;
  /** How many failed sends this row stands for. */
  count: number;
  latestAt: string;
};

/** A partner text that failed with no job (job offers to a trade): one row per business, shown in the Partner & system fold. */
export type PartnerSendFailedRow = { businessId: string; text: string; count: number; latestAt: string };

/** Plain names for the purposes/types the office sees most; anything else is shown as its raw key. */
export const PURPOSE_LABEL: Record<string, string> = {
  existing_leads_launch_v1: "Save my spot email", step3_estimate: "Save my spot email", email_preliminary_save_spot: "Preliminary Save my spot email",
  insulation_video_request: "Photo request email", three_questions_reminder: "3 questions reminder email", spot_saved_confirmation: "Spot saved email",
  estimate_followup_day_2: "Estimate reminder (day 2)", estimate_followup_day_7: "Estimate reminder (day 7)", estimate_followup_day_21: "Estimate reminder (day 21)",
  quote_reminder: "Quote reminder email", quote_accepted: "You're in email", safety_check_times: "Safety check times email", safety_check_booked: "Safety check booked email",
  fixes_quote: "Electrical fixes quote email", install_days: "Install days email", install_day_changed: "Install day changed email", install_complete: "All done email",
  final_invoice: "Final invoice email", completion_pack: "Completion pack email", warranty_followup: "Warranty follow-up email", review_request: "Review request email",
  job_cancelled: "Job cancelled email", job_cancelled_installer: "Job cancelled email (installer)",
  veec_sign_day_1: "Rebate form reminder (day 1)", veec_sign_day_3: "Rebate form reminder (day 3)", veec_sign_day_7: "Rebate form reminder (day 7)",
  piesa_owner_confirm_request: "Confirm your safety check email", piesa_owner_confirm_reminder_1: "Confirm your safety check reminder (day 1)", piesa_owner_confirm_reminder_3: "Confirm your safety check reminder (day 3)", piesa_owner_confirm: "Confirm your safety check text",
  piesa_owner_fixes_confirm_request: "Confirm your electrical fixes email", piesa_owner_fixes_confirm_reminder_1: "Confirm your electrical fixes reminder (day 1)", piesa_owner_fixes_confirm_reminder_3: "Confirm your electrical fixes reminder (day 3)", piesa_owner_fixes_confirm: "Confirm your electrical fixes text",
  save_spot_reminder: "Save my spot reminder text", spot_saved: "Spot saved text", quote_ready: "Quote ready text", owner_code: "Sign-in code text",
  veec_sign_request: "Rebate form request text", veec_sign_reminder: "Rebate form reminder text", three_questions_reminder_sms: "3 questions reminder text",
  job_offer: "Job offer text", install_clearance: "Install clearance text", install_window_reminder: "30-day reminder text", install_window_reminder_installer: "30-day reminder text (installer)",
  daily_mitti: "Morning Mitti text", daily_mitti_update: "Mitti update text", esc_notice_link: "ESC notice link text", usual_electrician_missing: "Usual electrician text", ready_check_incomplete: "Ready Check incomplete text",
  // Decision 326
  ready_check_times_owner: "Ready Check times text", ready_check_booked_owner: "Ready Check booked text", visit_tomorrow_owner: "See you tomorrow text",
  safety_check_booked_owner: "Safety check booked text", quote_reminder_sms: "Quote reminder text", install_moved: "Install moved text", piesa_offer: "Safety check job offer text",
  // Decision 376 (approved by Jo in decision 384)
  visit_new_times: "Visit cancelled – new times", owner_paperwork_copy: "Signed paperwork copy email",
  piesa_times_reminder: "Safety check times reminder text", installer_planning_notice: "Safety check booked text (installer)",
};

export function sendLabel(key: string, channel: "email" | "sms"): string {
  return PURPOSE_LABEL[channel === "sms" && PURPOSE_LABEL[`${key}_sms`] ? `${key}_sms` : key] ?? key.replace(/_/g, " ");
}

/** "today", "yesterday", "3 days ago". */
export function daysAgoLabel(iso: string, now: number): string {
  const days = Math.floor((now - Date.parse(iso)) / DAY);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

/** Twilio error codes the office meets, in plain words (Twilio's own descriptions, shortened). */
const TWILIO_PLAIN: Record<string, string> = {
  "21211": "not a valid phone number", "21614": "not a mobile number", "21408": "can't text that country", "21610": "the owner replied STOP",
  "30003": "phone off or out of range", "30004": "number blocked from receiving texts", "30005": "number doesn't exist", "30006": "landline or can't receive texts",
  "30007": "blocked by the phone company as spam", "30008": "phone company error",
};

/**
 * A provider's error in words the office can act on (design review 26 Oct: raw `Twilio 400: {"code":21614,…}` reached
 * Needs me). Known Twilio codes become a phrase; anything else loses its JSON so only readable words remain.
 */
export function plainSendError(raw: string | null | undefined): string {
  const v = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!v) return "";
  const code = v.match(/"code"\s*:\s*(\d{5})/)?.[1] ?? v.match(/\bTwilio(?: error)?\s*(\d{5})\b/i)?.[1];
  if (code && TWILIO_PLAIN[code]) return TWILIO_PLAIN[code];
  const message = v.match(/"message"\s*:\s*"((?:[^"\\]|\\.)*)"/)?.[1];
  if (message) return message.replace(/\\"/g, '"');
  return v.replace(/\{.*$/, "").replace(/[\s:—-]+$/, "").trim() || "provider error";
}

const trim = (s: string | null | undefined, n = 120) => { const v = (s ?? "").replace(/\s+/g, " ").trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };

/** The Needs me line for one text that failed or may not have arrived; null for anything else (delivered, queued, blocked quiet-hours holds). */
function smsLine(s: FailedSms, now: number): string | null {
  const when = `${sendLabel(s.message_type, "sms")}, ${daysAgoLabel(s.created_at, now)}`;
  if ((UNSURE_SMS_STATUSES as readonly string[]).includes(s.status)) return `Text not sure it arrived: ${when}`;
  if (!(FAILED_SMS_STATUSES as readonly string[]).includes(s.status)) return null;
  const why = trim(plainSendError(s.detail));
  return `Text ${s.status === "undelivered" ? "not delivered" : "failed"}: ${when}${why ? ` — ${why}` : ""}`;
}

/**
 * Partner texts with no job (e.g. a job offer to a trade): one row per business, newest first. Same window, same
 * statuses, same clearing rule (a later delivered text of the same kind to that business) as the per-job rows.
 */
export function partnerSendFailedRows(i: { now: number; sms: FailedSms[]; windowDays?: number; covered?: ReadonlySet<string> }): PartnerSendFailedRow[] {
  const since = i.now - (i.windowDays ?? SEND_FAILED_WINDOW_DAYS) * DAY;
  const lastOk = new Map<string, number>();
  for (const s of i.sms) if (!s.job_id && s.business_id && (SUCCESS_SMS_STATUSES as readonly string[]).includes(s.status)) { const k = `${s.business_id}|${s.message_type}`, t = Date.parse(s.created_at); if (t > (lastOk.get(k) ?? -Infinity)) lastOk.set(k, t); }
  const byBiz = new Map<string, { at: string; line: string }[]>();
  for (const s of i.sms) {
    if (s.job_id || !s.business_id || Date.parse(s.created_at) < since) continue;
    if (i.covered?.has(`${s.business_id}|${s.message_type}`)) continue; // already its own "Daily text to … failed" row
    const line = smsLine(s, i.now); if (!line) continue;
    if ((lastOk.get(`${s.business_id}|${s.message_type}`) ?? -Infinity) > Date.parse(s.created_at)) continue;
    byBiz.set(s.business_id, [...(byBiz.get(s.business_id) ?? []), { at: s.created_at, line }]);
  }
  const rows: PartnerSendFailedRow[] = [];
  for (const [businessId, fs] of byBiz) {
    fs.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const shown = fs.slice(0, 3).map((f) => f.line), more = fs.length - shown.length;
    rows.push({ businessId, count: fs.length, latestAt: fs[0]!.at, text: [...shown, more > 0 ? `and ${more} more` : null].filter(Boolean).join(" · ") });
  }
  return rows.sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt));
}

/** Daily trade text log kinds and the text type they send (daily-mitti-text.server). */
const TRADE_TEXT_SMS_TYPE: Record<string, string> = { daily: "daily_mitti", update: "daily_mitti_update" };
/** `business|text type` keys already shown as "Daily text to … failed" (open failed trade_text_log rows), so the
 *  job-less partner row doesn't show the same failure twice. */
export function tradeTextCoveredKeys(failedLog: { business_id: string | null; kind: string | null }[]): Set<string> {
  const out = new Set<string>();
  for (const r of failedLog) { const t = r.kind ? TRADE_TEXT_SMS_TYPE[r.kind] : undefined; if (r.business_id && t) out.add(`${r.business_id}|${t}`); }
  return out;
}

/**
 * One row per job: every confirmed email/text failure inside the window, newest first. Rows outside the window, rows
 * without a job and non-failure statuses are ignored. Text is ready for the Needs me "why" column.
 */
export function sendFailedRows(i: { now: number; emails: FailedEmailSend[]; sms: FailedSms[]; windowDays?: number }): SendFailedRow[] {
  const since = i.now - (i.windowDays ?? SEND_FAILED_WINDOW_DAYS) * DAY;
  type F = { jobId: string; at: string; line: string };
  const failures: F[] = [];
  // Latest success per job + kind: a failure followed by a success of the same kind is no longer a problem.
  const lastOk = new Map<string, number>();
  const ok = (key: string, at: string) => { const t = Date.parse(at); if (t > (lastOk.get(key) ?? -Infinity)) lastOk.set(key, t); };
  for (const e of i.emails) if ((SUCCESS_EMAIL_STATUSES as readonly string[]).includes(e.status)) ok(`email|${e.job_id}|${e.purpose}`, e.created_at);
  for (const s of i.sms) if (s.job_id && (SUCCESS_SMS_STATUSES as readonly string[]).includes(s.status)) ok(`sms|${s.job_id}|${s.message_type}`, s.created_at);
  const fixed = (key: string, at: string) => (lastOk.get(key) ?? -Infinity) > Date.parse(at);
  for (const e of i.emails) {
    const at = Date.parse(e.created_at);
    if (at < since) continue;
    const unsure = (UNSURE_EMAIL_STATUSES as readonly string[]).includes(e.status) && (e.status !== "sending" || i.now - at > STUCK_SENDING_MS);
    if (!(FAILED_EMAIL_STATUSES as readonly string[]).includes(e.status) && !unsure) continue;
    if (fixed(`email|${e.job_id}|${e.purpose}`, e.created_at)) continue;
    if (unsure) { failures.push({ jobId: e.job_id, at: e.created_at, line: `Email not sure it arrived: ${sendLabel(e.purpose, "email")}, ${daysAgoLabel(e.created_at, i.now)}` }); continue; }
    const why = trim(plainSendError(e.error));
    failures.push({ jobId: e.job_id, at: e.created_at, line: `Email failed: ${sendLabel(e.purpose, "email")}, ${daysAgoLabel(e.created_at, i.now)}${why ? ` — ${why}` : ""}` });
  }
  for (const s of i.sms) {
    if (!s.job_id || Date.parse(s.created_at) < since) continue;
    const line = smsLine(s, i.now); if (!line) continue;
    if (fixed(`sms|${s.job_id}|${s.message_type}`, s.created_at)) continue;
    failures.push({ jobId: s.job_id, at: s.created_at, line });
  }
  failures.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const byJob = new Map<string, F[]>();
  for (const f of failures) byJob.set(f.jobId, [...(byJob.get(f.jobId) ?? []), f]);
  const rows: SendFailedRow[] = [];
  for (const [jobId, fs] of byJob) {
    const shown = fs.slice(0, 3).map((f) => f.line);
    const more = fs.length - shown.length;
    rows.push({ jobId, count: fs.length, latestAt: fs[0]!.at, text: [...shown, more > 0 ? `and ${more} more` : null].filter(Boolean).join(" · ") });
  }
  rows.sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt));
  return rows;
}
