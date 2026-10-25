// "Send failed" rows for Needs me (decision 238 follow-up work). PURE: turns failed customer email sends and failed
// texts from the last 7 days into one row per job with plain text the office can act on. No I/O; the caller reads
// customer_email_sends / sms_messages and feeds the rows in. Nothing here resends anything.

export const SEND_FAILED_WINDOW_DAYS = 7;
const DAY = 86_400_000;

/** customer_email_sends statuses that are a confirmed failure (not "sending", not "delivered_unrecorded"). */
export const FAILED_EMAIL_STATUSES = ["failed"] as const;
/** sms_messages statuses that mean the text did not reach the phone (our "failed" plus Twilio's "undelivered"). */
export const FAILED_SMS_STATUSES = ["failed", "undelivered"] as const;

export type FailedEmailSend = { job_id: string; purpose: string; status: string; created_at: string; error: string | null };
export type FailedSms = { job_id: string | null; message_type: string; status: string; created_at: string; detail: string | null };

export type SendFailedRow = {
  jobId: string;
  /** "Email failed: Save my spot email, 2 days ago — Resend: invalid address" (newest failure first, up to 3). */
  text: string;
  /** How many failed sends this row stands for. */
  count: number;
  latestAt: string;
};

/** Plain names for the purposes/types the office sees most; anything else is shown as its raw key. */
export const PURPOSE_LABEL: Record<string, string> = {
  existing_leads_launch_v1: "Save my spot email", step3_estimate: "Save my spot email", email_preliminary_save_spot: "Preliminary Save my spot email",
  insulation_video_request: "Photo request email", three_questions_reminder: "3 questions reminder email", spot_saved_confirmation: "Spot saved email",
  estimate_followup_day_2: "Estimate reminder (day 2)", estimate_followup_day_7: "Estimate reminder (day 7)", estimate_followup_day_21: "Estimate reminder (day 21)",
  quote_reminder: "Quote reminder email", quote_accepted: "You're in email", safety_check_times: "Safety check times email", safety_check_booked: "Safety check booked email",
  fixes_quote: "Electrical fixes quote email", install_days: "Install days email", install_day_changed: "Install day changed email", install_complete: "All done email",
  final_invoice: "Final invoice email", completion_pack: "Completion pack email", review_request: "Review request email",
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

const trim = (s: string | null | undefined, n = 120) => { const v = (s ?? "").replace(/\s+/g, " ").trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };

/**
 * One row per job: every confirmed email/text failure inside the window, newest first. Rows outside the window, rows
 * without a job and non-failure statuses are ignored. Text is ready for the Needs me "why" column.
 */
export function sendFailedRows(i: { now: number; emails: FailedEmailSend[]; sms: FailedSms[]; windowDays?: number }): SendFailedRow[] {
  const since = i.now - (i.windowDays ?? SEND_FAILED_WINDOW_DAYS) * DAY;
  type F = { jobId: string; at: string; line: string };
  const failures: F[] = [];
  for (const e of i.emails) {
    if (!(FAILED_EMAIL_STATUSES as readonly string[]).includes(e.status) || Date.parse(e.created_at) < since) continue;
    const why = trim(e.error);
    failures.push({ jobId: e.job_id, at: e.created_at, line: `Email failed: ${sendLabel(e.purpose, "email")}, ${daysAgoLabel(e.created_at, i.now)}${why ? ` — ${why}` : ""}` });
  }
  for (const s of i.sms) {
    if (!s.job_id || !(FAILED_SMS_STATUSES as readonly string[]).includes(s.status) || Date.parse(s.created_at) < since) continue;
    const why = trim(s.detail);
    failures.push({ jobId: s.job_id, at: s.created_at, line: `Text ${s.status === "undelivered" ? "not delivered" : "failed"}: ${sendLabel(s.message_type, "sms")}, ${daysAgoLabel(s.created_at, i.now)}${why ? ` — ${why}` : ""}` });
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
