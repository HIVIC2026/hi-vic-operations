// ESC pre-install AP task + day-before pre-start check (Operating Model v2, step 10). Pure rules only.
import { DEFAULT_REGISTRY_FIELDS, EARLIEST_MS, LEAD_MS, PIISA_FROM_PIESA_DAYS, registryUpdateTimingReasons, sendTimingBlocker, type RegistryChange } from "./esc.core";
import { melbourneAt, melbourneYmd } from "./piesa-windows.core";
import { COLLECTION_NOTICE_BLOCK_MESSAGE } from "./esc-collection-notice.core";
import { whiteCardBlocker, type WhiteCardState } from "./worker-compliance.core";
import { coesOfficeLine } from "./coes-check.core";
import type { PrestartCertificate } from "./certificate-later.core";

export const ESC_URGENT_MS = 2 * 24 * 3600_000;
/** Part 9 Task 6 (Jo 2 Nov 2026): the GO / DON'T START check runs at 2pm Melbourne the day before (was 12pm) and 6:30am on the day. */
export const PRESTART_HOUR = 14; // 2pm Melbourne, the day before the install (the first GO slot; also the lock time)
export { PIISA_FROM_PIESA_DAYS }; // one constant (esc.core, Part 9 Task 4); re-exported for existing readers

const fmt = (iso: string) => new Date(iso).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
function addDays(ymd: string, n: number) { const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

export type EscNotice = { status: string; sent_at: string | null; submission_reference: string | null; scheduled_start: string; response?: unknown };
export type EscTaskCode = "esc_submit_due" | "esc_submit_urgent" | "esc_update_registry" | "esc_withdraw_resubmit";

const registryLabel = (k: string) => DEFAULT_REGISTRY_FIELDS.find((f) => f.key === k)?.label ?? k;

/** What the AP must do for the ESC notification right now, if anything. `change` is the robot's own rule (`registryChange`,
 *  Activity Guide v1.2 §3.3.3) comparing the sent notice's Table 5 payload with the current one: withdraw + resubmit when
 *  anything not updatable changed (e.g. the address, same start) or the timing fails; update on the same ID otherwise.
 *  Omitted / null (callers without a payload) keeps the start-only rule. */
export function escTask(i: { start: string; current: EscNotice | null; previousSent: EscNotice | null; change?: RegistryChange | null; now: Date }): { code: EscTaskCode; detail: string } | null {
  const s = Date.parse(i.start), now = i.now.getTime();
  if (now >= s) return null;
  const c = i.current;
  const curSent = !!c && (c.status === "sent" || c.status === "accepted") && !!c.sent_at && !!c.submission_reference && Date.parse(c.scheduled_start) === s;
  if (curSent) return null;
  const by = new Date(s - LEAD_MS).toISOString();
  const change = i.change ?? null;
  if (i.previousSent?.sent_at && change && change.action !== "none") {
    const moved = Date.parse(i.previousSent.scheduled_start) !== s;
    const what = moved ? `Install moved to ${fmt(i.start)}` : `${change.changed.map(registryLabel).join(", ")} changed`;
    return change.action === "withdraw_and_resubmit"
      ? { code: "esc_withdraw_resubmit", detail: `${what}. ${change.reasons.join(" ")} Withdraw the notification in the Registry and resubmit by ${fmt(by)}.` }
      : { code: "esc_update_registry", detail: `${what}. Update the notification in the Registry by ${fmt(by)}, then record it.` };
  }
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

export type EscReminderCode = "esc_window_open" | "esc_urgent_48h" | "esc_blocked_24h" | "esc_reopened" | "esc_details_changed";
/** Office reminder to raise right now for this booking (once per key). Derived from escTask: window open at 5 days,
 *  urgent at 48h, blocked at 24h, reopened when the install moved after a recorded submission, details changed when the
 *  notice's Table 5 facts changed with the same start (Part 9 Task 1; `change` forwarded to escTask). */
export function escReminder(i: { start: string; current: EscNotice | null; previousSent: EscNotice | null; change?: RegistryChange | null; now: Date }): { code: EscReminderCode; key: string; detail: string } | null {
  const t = escTask(i);
  if (!t) return null;
  const s = Date.parse(i.start), now = i.now.getTime();
  const moved = !!i.previousSent && Date.parse(i.previousSent.scheduled_start) !== s;
  const code: EscReminderCode = t.code === "esc_submit_due" ? "esc_window_open"
    : t.code === "esc_submit_urgent" ? (now >= s - LEAD_MS ? "esc_blocked_24h" : "esc_urgent_48h")
    : moved ? "esc_reopened" : "esc_details_changed";
  return { code, key: `${new Date(s).toISOString()}:${code}`, detail: t.detail };
}
export const ESC_REMINDER_TITLES: Record<EscReminderCode, string> = {
  esc_window_open: "ESC notification can be sent now",
  esc_urgent_48h: "ESC notification urgent — install in 48 hours or less",
  esc_blocked_24h: "ESC notification not recorded 24 hours before start — installation locked",
  esc_reopened: "Install date changed after the ESC notification — update, or withdraw and resubmit",
  // DRAFT (Part 9 Task 1, JO-APPROVAL-LIST): same start, the notice's details changed (address, Lead Installer, …).
  esc_details_changed: "Details changed after the ESC notification — update, or withdraw and resubmit",
};

// ── Lead Installer lock (Jo 2 Nov 2026, "Lead Installer / ESC 24h rule"): THE ONE lock rule, owned by Part 9 Task 9. The
// clock itself lives in the tiny import-free `lead-installer-lock.core.ts` (the installer home's Next step box shows it and
// must not pull this module's ESC/compliance imports onto its first load); these names are re-exported here, so Parts 5 and
// 7 import them from prestart.core exactly as the plan says. Server readers: lead-installer-confirm.server
// (assertLeadInstallerUnlocked), visit-allocation.server (refuseLockedLeadChange), in-house-booking.server (recordLeadChange),
// booking.server (validateBooking reschedule) — all read the CURRENT confirmed install booking through install-booking.server
// currentLockableInstallBooking, which ignores a completed install and throws on a read error (every gate fails closed).
export { LEAD_CONFIRM_EMAIL_HOUR, LEAD_LOCK_DAYS_BEFORE, LEAD_LOCK_HOUR, LEAD_LOCKED_MESSAGE, leadInstallerLock, leadInstallerLocked } from "./lead-installer-lock.core";

// ── GO / DON'T START slots (Part 9 Task 6). The 2pm-day-before slot is also the lock time (`prestartRunAt`).
export const GO_SLOTS = [
  { key: "day_before_2pm", dayOffset: -1, hour: 14, minute: 0 },
  { key: "on_day_630am", dayOffset: 0, hour: 6, minute: 30 },
] as const;
export type GoSlot = (typeof GO_SLOTS)[number]["key"];
/** Melbourne wall-clock instant of each slot for this install start, as ISO. (Minutes are added after the whole-hour
 *  DST-safe `melbourneAt`; neither slot sits inside a DST change, which happens at 2–3am.) */
export function goSlotTimes(startIso: string): Record<GoSlot, string> {
  const day = melbourneYmd(new Date(startIso));
  const out = {} as Record<GoSlot, string>;
  for (const s of GO_SLOTS) out[s.key] = new Date(melbourneAt(addDays(day, s.dayOffset), s.hour).getTime() + s.minute * 60_000).toISOString();
  return out;
}
/** The slot to run now: the LATEST slot whose time has passed, not yet done, and before the install starts. Null = nothing due. */
export function dueGoSlot(startIso: string, now: Date, done: readonly GoSlot[]): GoSlot | null {
  const t = now.getTime();
  if (t >= Date.parse(startIso)) return null;
  const times = goSlotTimes(startIso);
  const passed = GO_SLOTS.filter((s) => t >= Date.parse(times[s.key]));
  const latest = passed[passed.length - 1];
  if (!latest || done.includes(latest.key)) return null;
  return latest.key;
}
export const isGoSlot = (s: string): s is GoSlot => GO_SLOTS.some((x) => x.key === s);

/** 2pm Melbourne on the day before the install (the first GO slot; the lock time `prestartLocked` uses). */
export function prestartRunAt(startIso: string): string {
  return goSlotTimes(startIso).day_before_2pm;
}

/** `noticeAcknowledged`: ESC collection notice (decision 130); false = not acknowledged, blocks the start. Undefined = not loaded (older callers). */
/** `whiteCard`: decision 319 White Card state of the lead (worker-compliance.core); undefined = not loaded (older callers, never blocks). */
/** `escRegistered`: Part 9 Task 5 — the Lead Installer is registered with the ESC (partner_workers.esc_registered, office-audited); false blocks; undefined/null = not loaded (older callers, never blocks). */
export type LeadCert = { found: boolean; status: string | null; level: string | null; expiresOn: string | null; name: string | null; noticeAcknowledged?: boolean | null; whiteCard?: WhiteCardState | null; escRegistered?: boolean | null };
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
  /** H3 (24 Oct 2026) → Part 9 Task 8: the assigned installer business's insurance problems (businessDocsBlocker: not on file /
   *  unverified / expired / under $5m / no workers comp); undefined = not loaded (older callers). */
  businessDocsBlocker?: string | null | undefined;
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
  /** Part 3 Task 4 (Jo 3 Nov 2026): the install can be booked without the Certificate of Electrical Safety but can't start
   *  without it (certificate-later.core `prestartCertificate`); undefined = not loaded (older callers). */
  certificate?: PrestartCertificate | undefined;
  /** The existing certificate check's reason when `certificate` is "unchecked" (coes-check.core COES_WHY / rejected). */
  certificateWhy?: string | null | undefined;
  /** Part 9 Task 5: the PIESA asked for the electrician at the start of the install (install-attendance.core
   *  attendanceRequired) and their answer for THIS booking (attendanceState; never asked = waiting). null/undefined = not
   *  loaded or not needed (older callers, never blocks). */
  electricianAttendance?: { required: boolean; state: "confirmed" | "declined" | "waiting" } | null | undefined;
  /** Part 9 Task 5: life support at the home and no written consent / medical plan on file (job-records.server
   *  lifeSupportPlanMissing, which counts the electrician's PIESA photo). undefined = not loaded (older callers). */
  lifeSupportPlanMissing?: boolean | undefined;
  // Part 9 Task 10 (Jo 2 Nov 2026, answer 21): the GO check needs the Part C (the electrical clearance line above) and the
  // electrical certificate — the certificate gate is main's `certificate` / `certificateWhy` fact (Part 3 Task 4: "not in
  // yet" / "Check electrical certificate — …"), so T10's duplicate `coesBlocker` fact was dropped at the join (ruling 4).
};
export const CERTIFICATE_NOT_IN_YET = "Certificate of Electrical Safety not in yet";
export const LEAD_NOT_ESC_REGISTERED = (name: string | null) => `Lead Installer${name ? ` ${name}` : ""} is not registered with the ESC yet.`;
export const ELECTRICIAN_NOT_CONFIRMED = "The PIESA needs an electrician at the install and they haven't confirmed.";
export const LIFE_SUPPORT_PLAN_MISSING = "Life support at this home: the written consent or medical plan isn't on file.";

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
  if (f.businessDocsBlocker) out.push(`Installer business: ${f.businessDocsBlocker}`);
  if (f.swmsBlocker) out.push(f.swmsBlocker);
  if (f.installDepositBlocker) out.push(f.installDepositBlocker);
  for (const b of f.piesaCopyBlockers ?? []) out.push(b);
  if (f.piesaCopyReceiptBlocker) out.push(f.piesaCopyReceiptBlocker);
  if (f.certificate === "missing") out.push(CERTIFICATE_NOT_IN_YET);
  else if (f.certificate === "unchecked") out.push(coesOfficeLine(f.certificateWhy?.trim() || "not checked yet"));
  // Part 9 Task 5: ESC registration (every job), the electrician at the install when the PIESA needs them, life support plan.
  if (f.lead.found && f.lead.escRegistered === false) out.push(LEAD_NOT_ESC_REGISTERED(f.lead.name));
  if (f.electricianAttendance?.required && f.electricianAttendance.state !== "confirmed") out.push(ELECTRICIAN_NOT_CONFIRMED);
  if (f.lifeSupportPlanMissing) out.push(LIFE_SUPPORT_PLAN_MISSING);
  return out;
}

// ── Failure class for the DON'T START email (Jo 4 Nov 2026 14:40, Part 9 Task 7 fix). ─────────────────────────────
/** `fixable` = can still be fixed before the booked start (signatures, office ticks, a missing Lead, the deposit…);
 *  `must_move` = a timing rule is already broken relative to the booked start, so the install has to be rebooked. */
export type PrestartFailureClass = "fixable" | "must_move";
export type PrestartFailure = { line: string; cls: PrestartFailureClass };
/** Lines that are fixable whatever the clock says (people, paperwork and money the office or trade can sort before the start). */
const FIXABLE_ALWAYS: RegExp[] = [
  /^Safety plan not signed/, // SWMS signatures (decision 261)
  /^No lead installer is recorded/,
  /^Lead installer.*(has no office-verified|re-record certification|holds a provisional)/, // office verifies / picks another Lead
  /^Lead installer.*: /, // collection notice acknowledgement, White Card (worker-compliance lines are prefixed "Lead installer …: ")
  /^Installer business: /, // insurance upload waiting for the office tick (H3 / Task 8)
  /^Install deposit not paid/,
  /^Ready Check original condition not recorded/,
  /^Site conditions differ/,
  /^Life support at this home/, // Task 5: plan goes on file
  // Join (4 Nov 2026): main's Part 3 certificate lines — the electrician uploads the Certificate of Electrical Safety on
  // their link, the office ticks it (an upload + an office tick, like the insurance line).
  /^Certificate of Electrical Safety not in yet/,
  /^Check electrical certificate — /,
];
/** Lines about a 24-hour rule: fixable only while the start is still at least 24h away (the notice, consent, copies or
 *  confirmation can still land in time); from then on the rule is already broken → must move. */
const FIXABLE_WHILE_24H_LEFT: RegExp[] = [
  /^ESC notification is not marked submitted/,
  /^Owner consent: .*(not generated|not complete)/,
  /^Signed PIESA copy delivery to (owner|installer) must be recorded/,
  /not delivered to the (owner|installer) by/, // Task 5 Part C copy lines
  /^The PIESA needs an electrician at the install and they haven't confirmed/, // Task 5
];
/** Fail closed: anything not listed above (the 30-day window, PIISA/ESC timing, consent/notice/copies <24h, electrical
 *  clearance, lines this module doesn't know) is `must_move`. */
export function classifyPrestartFailure(line: string, i: { start: string; now: Date }): PrestartFailureClass {
  if (FIXABLE_ALWAYS.some((r) => r.test(line))) return "fixable";
  if (FIXABLE_WHILE_24H_LEFT.some((r) => r.test(line))) return i.now.getTime() <= Date.parse(i.start) - LEAD_MS ? "fixable" : "must_move";
  return "must_move";
}
export const classifyPrestartFailures = (lines: readonly string[], i: { start: string; now: Date }): PrestartFailure[] => lines.map((line) => ({ line, cls: classifyPrestartFailure(line, i) }));

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
