// Decision 158 (Jo, 24 Oct 2026) — the 30-day rule cost. Pure rules only; no network, no database.
// If the PIESA lapses before the install (30-day window from electrical clearance, `installWindowDeadline`), the repeat
// PIESA is paid by whoever caused the delay: owner or installer. Both get a reminder at 20 and 10 days before the last
// day (text + email). The existing single office alert at 10 days (`shouldFlagTenDaysLeft`) is unchanged.
// Everything here is DRAFT wording until Jo approves it: THIRTY_DAY_REMINDER_APPROVED stays false (no real email) and
// the two SMS types are wordingApproved:false (no real text). TEST jobs go through the test sender only.
import { myJobScreen } from "./mail-mjml.core";
import { INSTALL_WINDOW_DAYS, installDaysLeft } from "./install-days.core";
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { mjThirtyDayClock } from "./safety-check-emails.core";

/** Jo must approve the wording below before this turns on. */
export const THIRTY_DAY_REMINDER_APPROVED = true as boolean; // Jo 24 Oct 2026 (decision 167): texts and emails approved.

export const INSTALL_WINDOW_REMINDER_EVENT = "install_window_reminder";
export const INSTALL_WINDOW_EXPIRED_EVENT = "install_window_expired";
export type InstallWindowStep = "reminder_20" | "reminder_10";
export const INSTALL_WINDOW_REMINDER_STEPS: { step: InstallWindowStep; daysLeft: number }[] = [{ step: "reminder_20", daysLeft: 20 }, { step: "reminder_10", daysLeft: 10 }];

/**
 * How long each side has to make its move before the delay counts against them (calendar days). Assumption for Jo to
 * confirm: the installer should offer days within 5 days of clearance, and either side should answer within 5 days.
 */
export const RESPONSE_DUE_DAYS = 5;

/** Idempotency key for one reminder message. v2 (F11) carries the deadline: a new window (re-done PIESA → new clearance)
 *  gets its own 20/10-day messages instead of colliding with the first window's v1 keys. */
export const installWindowKey = (jobId: string, deadline: string, step: InstallWindowStep, who: "owner" | "installer", ch: "email" | "sms") =>
  `install-window:v2:${jobId}:${deadline}:${step}:${who}:${ch}`;

/**
 * Next reminder due now, lowest first so a short window (earlier stored deadline) still gets the 10-day one.
 * `done` = steps already recorded for THIS deadline (a new clearance/deadline starts again). `quiet` = SMS quiet hours
 * (8pm–7am Melbourne): nothing is due, so the step — recorded before sending — fires at the 07:00 tick with its text.
 */
export function dueInstallWindowReminder(x: { deadline: string | null; booked: boolean; expired: boolean; done: InstallWindowStep[]; now?: Date; quiet?: boolean }): InstallWindowStep | null {
  if (!x.deadline || x.booked || x.expired || x.quiet) return null;
  const left = installDaysLeft(x.deadline, x.now);
  if (left < 0) return null;
  if (left <= 10) return x.done.includes("reminder_10") ? null : "reminder_10";
  if (left <= 20) return x.done.includes("reminder_20") ? null : "reminder_20";
  return null;
}

// ---------- Reminder wording (approved by Jo 24 Oct 2026, decision 167) ----------
const longDate = (ymd: string) => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" }).format(new Date(`${ymd}T12:00:00+10:00`));
const dayWord = (n: number) => `${n} day${n === 1 ? "" : "s"}`;

export type ReminderFacts = { step: InstallWindowStep; deadline: string; daysLeft: number; link: string; jobNumber?: string | null; firstName?: string | null; installerName?: string | null; ownerSuburb?: string | null; test?: boolean };

/** Owner text. Under 2 segments; brand prefix is added by brandSmsBody; STOP line last. */
export function ownerInstallWindowText(f: ReminderFacts): string {
  const by = longDate(f.deadline);
  if (f.step === "reminder_20") return `Your insulation install must happen by ${by} (${dayWord(f.daysLeft)} left). Please agree an install day with your installer on your job page: ${f.link} Reply STOP to opt out.`;
  return `Only ${dayWord(f.daysLeft)} left: your install must happen by ${by} or your safety check runs out and a repeat check is charged to whoever caused the delay. Pick a day today: ${f.link} Reply STOP to opt out.`;
}

/** Installer text. No owner details beyond the job number. */
export function installerInstallWindowText(f: ReminderFacts): string {
  const by = longDate(f.deadline);
  const job = f.jobNumber ? `Job ${f.jobNumber}` : "Your job";
  if (f.step === "reminder_20") return `${job}: ${dayWord(f.daysLeft)} left in the 30-day install window (last day ${by}). Please agree an install day with the owner: ${f.link} Reply STOP to opt out.`;
  return `${job}: only ${dayWord(f.daysLeft)} left (last day ${by}). If the window lapses the repeat PIESA is charged to whoever caused the delay. Agree a day now: ${f.link} Reply STOP to opt out.`;
}

/** Owner email. Design: docs/templates/mjml/owner_install-window.mjml (MJML email refresh, Jo 27 Oct 2026). */
export function ownerInstallWindowEmail(f: ReminderFacts): { subject: string; html: string; text: string } {
  const first = K.cleanName(f.firstName) ?? "there";
  const by = longDate(f.deadline);
  const installer = f.installerName?.trim() || "your installer";
  const subject = f.step === "reminder_20" ? `${first}, ${dayWord(f.daysLeft)} left to book your install` : `${first}, only ${dayWord(f.daysLeft)} left on your safety check`;
  const introStart = `Your electrical safety check is valid for ${INSTALL_WINDOW_DAYS} days, so your insulation must be installed by`;
  const introEnd = `There ${f.daysLeft === 1 ? "is" : "are"} ${dayWord(f.daysLeft)} left and no day is agreed yet.`;
  const ask = `Please go to your job page and tap one of the days ${installer} has offered, or suggest days that suit you. It only takes a minute.`;
  // [bold part, rest] of the 30-day rule line.
  const rule: [string, string] = f.step === "reminder_20"
    ? ["If no day is agreed in time, the safety check runs out and a new one is needed before the install can go ahead.", ""]
    : ["If the window passes, a repeat safety check is needed before the install can go ahead.", "It is charged to whoever caused the delay (the owner or the installer)."];
  const ruleText = rule.filter(Boolean).join(" ");
  const questions = "Questions? Just reply to this email.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(subject)}</mj-text><mj-text>${esc(introStart)} <strong>${esc(by)}</strong>. ${esc(introEnd)}</mj-text><mj-text>${esc(ask)}</mj-text><mj-button href="${esc(myJobScreen(f.link, "book"))}">Pick my install day</mj-button></mj-column></mj-section>`,
    mjThirtyDayClock(`<strong>${esc(rule[0])}</strong>${rule[1] ? ` ${esc(rule[1])}` : ""}`),
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(questions)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const preview = `Your insulation must be installed by ${by}. Pick your install day – it takes a minute.`;
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: f.test === true });
  const text = K.plainText([subject, "", `${introStart} ${by}. ${introEnd}`, "", ask, `Pick my install day: ${myJobScreen(f.link, "book")}`, "", ruleText, "", questions], { testLabel: f.test === true });
  return { subject, html, text };
}

/** Installer email. Job number and suburb only — no owner contact details. Design: docs/templates/mjml/installer_install-window.mjml. */
export function installerInstallWindowEmail(f: ReminderFacts): { subject: string; html: string; text: string } {
  const first = K.cleanName(f.firstName) ?? "there";
  const by = longDate(f.deadline);
  const job = `${f.jobNumber ? `job ${f.jobNumber}` : "this job"}${f.ownerSuburb ? ` (${f.ownerSuburb})` : ""}`;
  const subject = `${f.jobNumber ?? "Job"}: ${dayWord(f.daysLeft)} left in the 30-day install window`;
  const hi = `Hi ${first},`;
  const intro = `The PIESA on ${job} is valid until ${by}. ${dayWord(f.daysLeft)} left and no install day is agreed.`;
  const ask = "Please offer days, or take one of the owner's suggested days, on the job screen now.";
  const rule = f.step === "reminder_20"
    ? "If the window lapses, a repeat PIESA is needed before the install can start."
    : "If the window lapses, a repeat PIESA is needed. Under the partner agreement it's charged to whoever caused the delay — the owner or the installer.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(subject)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-amber"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Valid until</mj-text><mj-text mj-class="center" font-family="Outfit, Figtree, Arial, Helvetica, sans-serif" font-size="26px" line-height="32px" font-weight="800" color="#8A5200" padding="0 12px 4px">${esc(by)}</mj-text><mj-text mj-class="center" font-weight="700" padding="0 12px 18px">${esc(dayWord(f.daysLeft))} left</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="14px 12px 14px">${esc(ask)}</mj-text><mj-button href="${esc(f.link)}">Open the job</mj-button><mj-text mj-class="small">${esc(rule)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const preview = `The PIESA on ${f.jobNumber ?? "this job"} is valid until ${by} and no install day is agreed yet.`;
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: f.test === true });
  const text = K.plainText([hi, subject, "", intro, "", ask, `Open the job: ${f.link}`, "", rule], { testLabel: f.test === true });
  return { subject, html, text };
}

// ---------- Who pays the repeat PIESA ----------
export type InstallWindowEvent = {
  type: string;
  /** ISO instant. */
  at: string;
  details?: { who?: string | null; days?: unknown[] | null } | null;
  summary?: string | null;
};
export type RepeatPiesaPayer = "owner" | "installer" | "undetermined";
export type RepeatPiesaDecision = { payer: RepeatPiesaPayer; reason: string; basis: string };

const ymd = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const who = (e: InstallWindowEvent): "owner" | "installer" | null => {
  const w = e.details?.who;
  if (w === "owner" || w === "installer") return w;
  const s = (e.summary ?? "").trim().toLowerCase();
  return s.startsWith("owner") ? "owner" : s.startsWith("installer") ? "installer" : null;
};
const dayOf = (d: unknown): string | null => typeof d === "string" ? d.slice(0, 10) : d && typeof d === "object" && typeof (d as { day?: unknown }).day === "string" ? (d as { day: string }).day.slice(0, 10) : null;

/**
 * Decides from the install-days history who caused the lapse. Only meaningful once the window has expired with no
 * installation booked; otherwise "undetermined — window has not lapsed".
 *  - installer never offered days (or offered none within RESPONSE_DUE_DAYS of clearance and never after) → installer
 *  - owner suggested days all outside the window → owner
 *  - a booked day was changed (by owner or installer) and nothing was re-agreed → the one who changed it, unless the
 *    other side then sat on its move for more than RESPONSE_DUE_DAYS (both contributed → undetermined, office decides)
 *  - otherwise whoever's move it was when the window closed (owner after an installer offer; installer after owner days)
 *  - a booking the system could not confirm as the last act → undetermined
 */
export function repeatPiesaPayer(i: { clearanceDate: string | null; deadline: string | null; expired: boolean; booked: boolean; events: InstallWindowEvent[] }): RepeatPiesaDecision {
  if (!i.expired || i.booked) return { payer: "undetermined", reason: "The 30-day window has not lapsed.", basis: "not_lapsed" };
  if (!i.deadline) return { payer: "undetermined", reason: "No install deadline is recorded for this job.", basis: "no_deadline" };
  const ev = [...i.events].filter((e) => Date.parse(e.at) <= Date.parse(`${i.deadline}T23:59:59+11:00`) + 86_400_000).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  let turn: "installer" | "owner" = "installer";
  let turnSince: string | null = i.clearanceDate ? i.clearanceDate.slice(0, 10) : null;
  let installerOffered = false;
  let lateChange: { who: "owner" | "installer"; at: string } | null = null;
  let last: InstallWindowEvent | null = null;
  for (const e of ev) {
    last = e;
    switch (e.type) {
      case "install_days_offered_by_installer": installerOffered = true; turn = "owner"; turnSince = ymd(e.at); break;
      case "install_days_offered": {
        const days = (e.details?.days ?? []).map(dayOf).filter((d): d is string => !!d);
        if (days.length && days.every((d) => d > i.deadline!)) return { payer: "owner", reason: `Owner suggested only days after the last allowed day (${i.deadline}) on ${ymd(e.at)}.`, basis: "owner_days_outside_window" };
        turn = "installer"; turnSince = ymd(e.at); break;
      }
      case "install_day_taken": turn = "owner"; turnSince = ymd(e.at); break; // booked by the owner; only a later change reopens it
      case "install_day_changed": {
        const w = who(e);
        if (w) lateChange = { who: w, at: ymd(e.at) };
        turn = "installer"; turnSince = ymd(e.at); break; // the installer offers new days after any change
      }
      default: break;
    }
  }
  if (last?.type === "install_day_booking_blocked") return { payer: "undetermined", reason: "The last agreed day could not be confirmed by the system, so neither side is charged automatically. Office to decide.", basis: "booking_blocked" };
  const waited = turnSince ? daysBetween(turnSince, i.deadline) : null;
  if (lateChange) {
    const other = lateChange.who === "owner" ? "installer" : "owner";
    if (turn === other && waited != null && waited > RESPONSE_DUE_DAYS) {
      return { payer: "undetermined", reason: `${cap(lateChange.who)} changed the booked day on ${lateChange.at}, then the ${other} did not answer for ${waited} days before the window closed on ${i.deadline}. Both contributed — office to decide.`, basis: "both_contributed" };
    }
    return { payer: lateChange.who, reason: `${cap(lateChange.who)} changed the booked install day on ${lateChange.at} and no new day was agreed before the window closed on ${i.deadline}.`, basis: "changed_booked_day" };
  }
  if (!installerOffered) {
    const since = i.clearanceDate ? ` since clearance on ${i.clearanceDate.slice(0, 10)}` : "";
    return { payer: "installer", reason: `Installer did not offer any install days${since} (expected within ${RESPONSE_DUE_DAYS} days); the window closed on ${i.deadline}.`, basis: "installer_never_offered" };
  }
  if (turn === "owner") return { payer: "owner", reason: `Owner did not take or answer the installer's install days offered on ${turnSince} before the window closed on ${i.deadline}.`, basis: "owner_no_answer" };
  return { payer: "installer", reason: `Installer did not take or answer the owner's suggested days from ${turnSince} before the window closed on ${i.deadline}.`, basis: "installer_no_answer" };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line for the office job page / history. */
export function repeatPiesaPayerLine(d: RepeatPiesaDecision): string {
  const head = d.payer === "undetermined" ? "30-day window lapsed — repeat PIESA payer undetermined" : `30-day window lapsed — repeat PIESA payable by the ${d.payer}`;
  return `${head}: ${d.reason}`;
}

// ---------- What the owner pays for the repeat PIESA (decision 342, Jo 25 Oct 2026) ----------
/**
 * An owner-caused lapse: the owner pays the SAME safety-check amount as their first check — the job's quote PIESA line
 * (decision 302: $349 with our electrician, or the approved REC's onboarded rate e.g. $220), never a new price. Nothing
 * charges the repeat check automatically yet, so the amount is recorded on the `install_window_expired` decision event
 * for the office / invoice to use. Installer-caused: nothing is charged to the owner (partner agreement). Undetermined:
 * no charge until the office decides; the first-check amount is kept on the event for reference.
 */
export type RepeatPiesaCharge = {
  payer: RepeatPiesaPayer;
  /** What the owner is charged for the repeat check, inc GST; null unless the owner caused the lapse. */
  ownerChargeIncGst: number | null;
  /** The owner's first safety-check amount (the quote's PIESA line), inc GST; null when unknown. */
  firstSafetyCheckIncGst: number | null;
  firstSafetyCheckSource: "quote_line" | "setting" | "default" | null;
};
export function repeatPiesaCharge(d: RepeatPiesaDecision, firstCheck: { cents: number; source: "quote_line" | "setting" | "default" } | null): RepeatPiesaCharge {
  const first = firstCheck && Number.isFinite(firstCheck.cents) && firstCheck.cents > 0 ? Math.round(firstCheck.cents) / 100 : null;
  return { payer: d.payer, ownerChargeIncGst: d.payer === "owner" ? first : null, firstSafetyCheckIncGst: first, firstSafetyCheckSource: first == null ? null : firstCheck!.source };
}
const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
/** Office next-action line once the window has lapsed. */
export function repeatPiesaNextAction(c: RepeatPiesaCharge): string {
  if (c.payer === "undetermined") return "New PIESA needed: 30-day window lapsed — office to decide who pays the repeat PIESA";
  if (c.payer === "installer") return "New PIESA needed: 30-day window lapsed — repeat PIESA payable by the installer";
  return c.ownerChargeIncGst != null
    ? `New PIESA needed: 30-day window lapsed — repeat PIESA payable by the owner (${money(c.ownerChargeIncGst)} inc GST, same as their first safety check)`
    : "New PIESA needed: 30-day window lapsed — repeat PIESA payable by the owner (same amount as their first safety check — office to confirm the figure)";
}
