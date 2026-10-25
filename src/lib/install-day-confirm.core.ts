// Decision 328 (Jo, 25 Oct 2026): installers miss the AFTER-work part of the "A5 – Install day" Mitti form, so the portal
// confirms the form before they leave site. PURE: no database, no network.
//  - When the A5 audit is marked Complete in Mitti, the portal checks it (the single-job A5 sync) and texts the lead
//    installer ONE result per audit revision: "All filled in ✓ You can leave site." or "Not finished — <first 3 items>…".
//  - The installer can run the same check from "Check my form now" on /field/day/{jobId} and /field/{jobId}; the screen
//    shows the same result.
//  - At 5pm Melbourne on the (last) install day, if the A5 is still not Complete, the lead installer gets ONE reminder.
// Wording is Jo's, verbatim (the sender adds "Home Insulation Victoria: "). Senders: install-day-confirm.server.ts.
import type { InstallEvidenceSummary } from "./install-evidence.core";

export const INSTALL_DAY_RESULT_SMS_TYPE = "install_day_form_result" as const;
export const INSTALL_DAY_REMINDER_SMS_TYPE = "install_day_form_reminder" as const;
/** Recorded once per audit revision BEFORE the result text is sent (the key names the revision). */
export const INSTALL_DAY_RESULT_EVENT = "install_day_form_result_sent" as const;
/** Recorded once per job + install day BEFORE the 5pm reminder is sent. */
export const INSTALL_DAY_REMINDER_EVENT = "install_day_form_reminder_sent" as const;
/** 5pm Melbourne on the install day. */
export const INSTALL_DAY_REMINDER_HOUR = 17;
/** The final A5 tick (decision 328) — unticked = the form is not complete. Same words as the blocker in install-evidence.core. */
export const FINAL_TICK_MISSING = "Final tick (every answer, photo and video filled in) not ticked";

// ---- wording (verbatim, Jo 25 Oct 2026) ----
export function installDayAllFilledInText(i: { jobNumber: string; address: string | null }): string {
  return `${[i.jobNumber, i.address?.trim() || null].filter(Boolean).join(" ")}: All filled in ✓ You can leave site.`;
}
export function installDayNotFinishedText(i: { jobNumber: string; missing: readonly string[] }): string {
  return `${i.jobNumber}: Not finished — ${firstMissing(i.missing)}. Don't leave site. Open the Mitti form, finish it and press Complete again.`;
}
export function installDayReminderText(i: { jobNumber: string }): string {
  return `${i.jobNumber}: your install day form isn't complete yet. Don't leave site until it is and the portal texts you "All filled in".`;
}
/** The first three missing items, joined for a text (trailing full stops dropped, each kept short). */
export function firstMissing(missing: readonly string[], n = 3): string {
  const items = missing.slice(0, n).map((m) => m.trim().replace(/[.\s]+$/, "")).map((m) => (m.length > 90 ? `${m.slice(0, 87).trimEnd()}…` : m));
  return items.length ? items.join("; ") : "the form needs checking";
}

// ---- the result ----
export type InstallDayFormState = "not_complete" | "all_filled_in" | "not_finished";
export type InstallDayFormInput = {
  /** Mitti reports the A5 audit marked Complete. */
  formCompleted: boolean;
  /** The "A5 – Install day" template (the final tick applies). The old A3 has no final tick. */
  installDayForm: boolean;
  /** The decision-328 final tick is ticked on the form. */
  finalTickTicked: boolean;
  /** The single-job A5 sync outcome: the signed installer declaration saved (saved / already) or why not. */
  declaration: { ok: boolean; message: string };
  /** The install-day evidence read from the same audit (null = not read). */
  summary: Pick<InstallEvidenceSummary, "applies" | "blockers"> | null;
};
export type InstallDayFormResult = { state: InstallDayFormState; missing: string[] };

/** Pure: is the Complete A5 really all filled in? Evidence first, then the declaration, then the final tick. */
export function installDayFormResult(i: InstallDayFormInput): InstallDayFormResult {
  if (!i.formCompleted) return { state: "not_complete", missing: [] };
  const missing: string[] = [];
  if (!i.summary) missing.push("The portal couldn't read the form yet");
  else if (i.summary.applies) missing.push(...i.summary.blockers);
  if (!i.declaration.ok) missing.push(...i.declaration.message.split(" • ").map((s) => s.trim()).filter(Boolean));
  if (i.installDayForm && !i.finalTickTicked) missing.push(FINAL_TICK_MISSING);
  const uniq = [...new Set(missing)];
  return uniq.length ? { state: "not_finished", missing: uniq } : { state: "all_filled_in", missing: [] };
}

/** The result text for a checked, Complete form (null while the form is not Complete — nothing is texted then). */
export function installDayResultText(r: InstallDayFormResult, job: { jobNumber: string; address: string | null }): string | null {
  if (r.state === "all_filled_in") return installDayAllFilledInText(job);
  if (r.state === "not_finished") return installDayNotFinishedText({ jobNumber: job.jobNumber, missing: r.missing });
  return null;
}

/** Same words on screen ("Check my form now"). */
export function installDayScreenLine(r: InstallDayFormResult): { title: string; body: string; good: boolean } {
  if (r.state === "all_filled_in") return { title: "All filled in ✓", body: "You can leave site.", good: true };
  if (r.state === "not_finished") return { title: "Not finished", body: "Don't leave site. Open the Mitti form, finish it and press Complete again.", good: false };
  return { title: "Not marked Complete yet", body: "Finish every page of the Mitti form (after videos, depth photos and finishing up), then press Complete.", good: false };
}

// ---- keys and timing ----
/** One result text per audit revision (the Mitti modified time; unknown = the audit's completed state only). */
export const installDayResultKey = (jobId: string, auditId: string, revision: string | null) => `install-day-form-result:v1:${jobId}:${auditId}:${revision ?? "complete"}`;
export const installDayReminderKey = (jobId: string, installDate: string) => `install-day-form-reminder:v1:${jobId}:${installDate}`;

/** Melbourne calendar date and hour of an instant. */
export function melbourneParts(now: Date): { ymd: string; hour: number } {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { ymd: `${g("year")}-${g("month")}-${g("day")}`, hour: Number(g("hour")) };
}
/** Is today (Melbourne) one of the booked install days (start..end, inclusive)? */
export function isInstallDayToday(today: string, startYmd: string | null, endYmd: string | null): boolean {
  if (!startYmd) return false;
  return today >= startYmd && today <= (endYmd && endYmd >= startYmd ? endYmd : startYmd);
}
/** The result text goes only on an install day (a check on another day shows on screen but texts nothing). */
export function resultTextDue(i: { formCompleted: boolean; installDayToday: boolean; alreadySentForRevision: boolean }): boolean {
  return i.formCompleted && i.installDayToday && !i.alreadySentForRevision;
}
/** 5pm reminder: on the LAST install day, from 17:00 Melbourne, form not Complete, not sent before for that day. */
export function reminderDue(i: { now: Date; lastInstallDay: string | null; formCompleted: boolean; installationRecorded: boolean; alreadySent: boolean }): boolean {
  if (!i.lastInstallDay || i.formCompleted || i.installationRecorded || i.alreadySent) return false;
  const m = melbourneParts(i.now);
  return m.ymd === i.lastInstallDay && m.hour >= INSTALL_DAY_REMINDER_HOUR;
}
