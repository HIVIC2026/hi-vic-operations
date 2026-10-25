// ESC pre-install AP task + day-before pre-start check (Operating Model v2, step 10). Pure rules only.
import { EARLIEST_MS, LEAD_MS, registryUpdateTimingReasons, sendTimingBlocker } from "./esc.core";
import { melbourneAt, melbourneYmd } from "./piesa-windows.core";
import { COLLECTION_NOTICE_BLOCK_MESSAGE } from "./esc-collection-notice.core";
import { whiteCardBlocker, type WhiteCardState } from "./worker-compliance.core";

export const ESC_URGENT_MS = 2 * 24 * 3600_000;
export const PRESTART_HOUR = 12; // 12pm Melbourne, the day before the install
export const PIISA_FROM_PIESA_DAYS = 30;

const fmt = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

export type EscNotice = { status: string; sent_at: string | null; submission_reference: string | null; scheduled_start: string; response?: unknown };
export type EscTaskCode = "esc_submit_due" | "esc_submit_urgent" | "esc_update_registry" | "esc_withdraw_resubmit";

/** What the AP must do for the ESC notification right now, if anything. */
export function escTask(i: { start: string; current: EscNotice | null; previousSent: EscNotice | null; now: Date }): { code: EscTaskCode; detail: string } | null {
  const s = Date.parse(i.start), now = i.now.getTime();
  if (now >= s) return null;
  const c = i.current;
  const curSent = !!c && (c.status === "sent" || c.status === "accepted") && !!c.sent_at && !!c.submission_reference && Date.parse(c.scheduled_start) === s;
  if (curSent) return null;
  const by = new Date(s - LEAD_MS).toISOString();
  if (i.previousSent?.sent_at && Date.parse(i.previousSent.scheduled_start) !== s) {
    // Activity Guide v1.2 §3.3.3: update (same ID) only while the original start has not passed and the new start is within 5 days.
    const ok = registryUpdateTimingReasons(i.previousSent.scheduled_start, i.start, i.now.toISOString()).length === 0;
    return ok
      ? { code: "esc_update_registry", detail: `Install moved to ${fmt(i.start)}. Update the notification in the Registry by ${fmt(by)}, then record it.` }
      : { code: "esc_withdraw_resubmit", detail: `Install moved to ${fmt(i.start)}, outside the original notification's window. Withdraw it and resubmit by ${fmt(by)}.` };
  }
  if (now < s - EARLIEST_MS) return null;
  if (now >= s - LEAD_MS) return { code: "esc_submit_urgent", detail: `ESC notification was not recorded 24 hours before the start (${fmt(by)}). The installation form and evidence stay locked until it is recorded or the install is rebooked.` };
  return now >= s - ESC_URGENT_MS
    ? { code: "esc_submit_urgent", detail: `Submit ESC notification by ${fmt(by)} — install is in 2 days or less.` }
    : { code: "esc_submit_due", detail: `Submit ESC notification in the VEU Registry by ${fmt(by)} (window is open now).` };
}

export type EscReminderCode = "esc_window_open" | "esc_urgent_48h" | "esc_blocked_24h" | "esc_reopened";
/** Office reminder to raise right now for this booking (once per key). Derived from escTask: window open at 5 days,
 *  urgent at 48h, blocked at 24h, reopened when the install moved after a recorded submission. */
export function escReminder(i: { start: string; current: EscNotice | null; previousSent: EscNotice | null; now: Date }): { code: EscReminderCode; key: string; detail: string } | null {
  const t = escTask(i);
  if (!t) return null;
  const s = Date.parse(i.start), now = i.now.getTime();
  const code: EscReminderCode = t.code === "esc_submit_due" ? "esc_window_open"
    : t.code === "esc_submit_urgent" ? (now >= s - LEAD_MS ? "esc_blocked_24h" : "esc_urgent_48h")
    : "esc_reopened";
  return { code, key: `${new Date(s).toISOString()}:${code}`, detail: t.detail };
}
export const ESC_REMINDER_TITLES: Record<EscReminderCode, string> = {
  esc_window_open: "ESC notification can be sent now",
  esc_urgent_48h: "ESC notification urgent — install in 48 hours or less",
  esc_blocked_24h: "ESC notification not recorded 24 hours before start — installation locked",
  esc_reopened: "Install date changed after the ESC notification — update, or withdraw and resubmit",
};

/** 12pm Melbourne on the day before the install. */
export function prestartRunAt(startIso: string): string {
  return melbourneAt(addDays(melbourneYmd(new Date(startIso)), -1), PRESTART_HOUR).toISOString();
}

/** `noticeAcknowledged`: ESC collection notice (decision 130); false = not acknowledged, blocks the start. Undefined = not loaded (older callers). */
/** `whiteCard`: decision 319 White Card state of the lead (worker-compliance.core); undefined = not loaded (older callers, never blocks). */
export type LeadCert = { found: boolean; status: string | null; level: string | null; expiresOn: string | null; name: string | null; noticeAcknowledged?: boolean | null; whiteCard?: WhiteCardState | null };
export type PrestartFacts = {
  start: string;
  clearance: { cleared: boolean; blocker: string | null };
  deadline: string | null; // 30-day window last day
  esc: EscNotice | null;
  lead: LeadCert;
  consentBlockers: string[];
  piesaCompletedAt: string | null;
  readyCheckWorksBlockers?: string[] | undefined; // installer-intake jobs: original-condition answers not yet recorded
  siteHoldBlockers?: string[] | undefined; // open "Site conditions differ" review hold
  /** H3 (24 Oct 2026): the assigned installer business's lapsed public liability insurance (publicLiabilityBlocker); undefined = not loaded (older callers). */
  publicLiabilityBlocker?: string | null | undefined;
  /** Decision 261: "Safety plan not signed: …" until the lead and every listed installer signed the portal SWMS; undefined = not loaded (older callers). */
  swmsBlocker?: string | null | undefined;
  /** Decision 319: when this installation booking was made. Bookings made before `WHITE_CARD_ENFORCED_FROM` are never blocked by the White Card rule. */
  bookingCreatedAt?: string | null | undefined;
  /** Decision 367: "Install deposit not paid" while the 10% deposit for this booking is unpaid (payment rule jobs);
   *  null = paid / not under the payment rule; undefined = not loaded (older callers, never blocks). */
  installDepositBlocker?: string | null | undefined;
  /** Decision 395: signed PIESA copies not delivered to the owner / installer 24h before the start (esc.core
   *  piesaCopyDeliveryBlockers, the rule Installation complete uses); undefined = not loaded (older callers). */
  piesaCopyBlockers?: string[] | undefined;
  /** Decision 395: the owner has not ticked "I have received it" for their safety check copy (Gate C piesa_copy_receipt,
   *  owner-gates.core piesaCopyReceiptBlocker); null = ticked; undefined = not loaded (older callers). */
  piesaCopyReceiptBlocker?: string | null | undefined;
};

/** Every failed pre-start condition, in plain words. Empty = cleared to start. */
export function prestartFailures(f: PrestartFacts): string[] {
  const out: string[] = [];
  const day = melbourneYmd(new Date(f.start));
  if (!f.clearance.cleared) out.push(`Electrical clearance is not valid: ${f.clearance.blocker ?? "not cleared"}`);
  if (!f.deadline || day > f.deadline) out.push(f.deadline ? `The 30-day window ended on ${f.deadline}. New PIESA needed.` : "No 30-day window date is recorded.");
  const e = f.esc;
  if (!e || !(e.status === "sent" || e.status === "accepted") || !e.sent_at || !e.submission_reference || Date.parse(e.scheduled_start) !== Date.parse(f.start)) out.push("ESC notification is not marked submitted for this install date.");
  else { const t = sendTimingBlocker(e.sent_at, f.start); if (t) out.push(t); }
  if (!f.lead.found) out.push("No lead installer is recorded for this job.");
  else if (f.lead.status !== "verified") out.push(`Lead installer${f.lead.name ? ` ${f.lead.name}` : ""} has no office-verified EEC CII certification.`);
  else if (!f.lead.level || !f.lead.expiresOn) out.push(`Lead installer${f.lead.name ? ` ${f.lead.name}` : ""}: re-record certification as Full with expiry date.`);
  else if (f.lead.level !== "full") out.push(`Lead installer${f.lead.name ? ` ${f.lead.name}` : ""} holds a provisional certification, not full.`);
  else if (f.lead.expiresOn < day) out.push(`Lead installer's certification expired on ${f.lead.expiresOn}.`);
  if (f.lead.found && f.lead.noticeAcknowledged === false) out.push(`Lead installer${f.lead.name ? ` ${f.lead.name}` : ""}: ${COLLECTION_NOTICE_BLOCK_MESSAGE}`);
  { const wc = f.lead.found ? whiteCardBlocker(f.lead.whiteCard, f.bookingCreatedAt) : null; if (wc) out.push(`Lead installer${f.lead.name ? ` ${f.lead.name}` : ""}: ${wc}`); }
  for (const c of f.consentBlockers) out.push(`Owner consent: ${c}`);
  if (!f.piesaCompletedAt) out.push("PIESA completion date is missing.");
  else if (day > addDays(f.piesaCompletedAt.slice(0, 10), PIISA_FROM_PIESA_DAYS)) out.push("The installer safety form (PIISA) can only be done within 30 days of the PIESA.");
  for (const b of f.readyCheckWorksBlockers ?? []) out.push(`Ready Check original condition not recorded: ${b}.`);
  for (const b of f.siteHoldBlockers ?? []) out.push(b);
  if (f.publicLiabilityBlocker) out.push(`Installer business: ${f.publicLiabilityBlocker}`);
  if (f.swmsBlocker) out.push(f.swmsBlocker);
  if (f.installDepositBlocker) out.push(f.installDepositBlocker);
  for (const b of f.piesaCopyBlockers ?? []) out.push(b);
  if (f.piesaCopyReceiptBlocker) out.push(f.piesaCopyReceiptBlocker);
  return out;
}

/** Office Needs me (decision 395): per job, the latest pre-start check when it FAILED for a currently confirmed install
 *  start — the same rule as prestartNeeds (latest check, same start). The office sees what is missing the day before. */
export function prestartFailedFor(
  bookings: readonly { job_id: string; scheduled_start: string }[],
  checks: readonly { job_id: string; scheduled_start: string; passed: boolean; failures: string[]; checked_at: string }[],
): Map<string, { at: string; reasons: string[] }> {
  const starts = new Map<string, Set<number>>();
  for (const b of bookings) { const t = Date.parse(b.scheduled_start); if (!starts.has(b.job_id)) starts.set(b.job_id, new Set()); starts.get(b.job_id)!.add(t); }
  const latest = new Map<string, (typeof checks)[number]>();
  for (const c of checks) { const p = latest.get(c.job_id); if (!p || c.checked_at > p.checked_at) latest.set(c.job_id, c); }
  const out = new Map<string, { at: string; reasons: string[] }>();
  for (const [id, c] of latest) if (!c.passed && starts.get(id)?.has(Date.parse(c.scheduled_start))) out.set(id, { at: c.checked_at, reasons: c.failures });
  return out;
}

/** Is installation work (PIISA send, install evidence) locked for this booking? */
export function prestartLocked(i: { start: string; latest: { scheduled_start: string; passed: boolean; failures: string[] } | null; now: Date }): { locked: boolean; reasons: string[] } {
  const same = i.latest && Date.parse(i.latest.scheduled_start) === Date.parse(i.start) ? i.latest : null;
  if (same && !same.passed) return { locked: true, reasons: same.failures };
  if (!same && i.now.getTime() >= Date.parse(prestartRunAt(i.start))) return { locked: true, reasons: ["The pre-start check has not run yet for this install date."] };
  return { locked: false, reasons: [] };
}

export const INSTALL_EVIDENCE_CATEGORIES = ["installation_progress", "completed_installation", "installer_declaration", "post_install_video", "final_zone_plan"];
