// Decision 215 (Jo, 24 Oct 2026): after an install-day "Couldn't get in?" the owner gets a text + email at once —
// "We couldn't get in today". If the installer's three new days are already offered they are included; otherwise the
// email says the installer will send new days (the normal install-days email O33 follows). Nobody is charged, the
// 30-day clock keeps running and the email states the end date. The office is alerted only on the SECOND no-access on
// the same job (decision 214 alert path, `needs_office` on the trade_couldnt_get_in event).
// DRAFT wording (not yet approved by Jo): text type `install_no_access` has wordingApproved=false, the email flag below
// is false — TEST jobs still see both through test-send. Design: docs/templates/mjml/owner_O65.mjml.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import type { ReadyCheckTimeSlot } from "./ready-check-times-email.core";
import { SMS_QUIET_REASON, smsQuietReason } from "./quote-hold.core";

/** Flip to true only when Jo approves the O65 wording (and the SMS type in sms.core at the same time). */
export const INSTALL_NO_ACCESS_NOTICE_APPROVED = true as boolean; // Jo approved the text + O65 email wording 24 Oct 2026 (decision 217)
export const INSTALL_NO_ACCESS_SMS_TYPE = "install_no_access";
/** Recorded once per cancelled install booking BEFORE anything is sent, so a retry never repeats the notice. */
export const INSTALL_NO_ACCESS_NOTICE_EVENT = "install_no_access_owner_notice";

/** Decision 215: the office is alerted on the second no-access on the same job, not the first. */
export function installNoAccessAlertsOffice(priorInstallNoAccessCount: number): boolean {
  return priorInstallNoAccessCount >= 1;
}

/** Decision 215 / spec D4: the text is held after 8pm (quiet hours; a held text never claims its key). The tick sends it once
 *  from 7am: key unclaimed, every earlier hold was the quiet-hours hold, and the report is under 24 hours old. */
export function installNoAccessTextCatchUpDue(f: { claimed: boolean; heldReasons: string[]; reportedAt: string }, nowIso: string): boolean {
  if (smsQuietReason(nowIso)) return false;
  if (f.claimed || f.heldReasons.length === 0) return false;
  const at = Date.parse(f.reportedAt), now = Date.parse(nowIso);
  if (!Number.isFinite(at) || !Number.isFinite(now) || now - at > 24 * 3600_000) return false;
  return f.heldReasons.every((r) => r === SMS_QUIET_REASON);
}

export type InstallNoAccessFacts = {
  firstName: string | null;
  installerName: string | null;
  /** The install day that didn't happen, e.g. "Tuesday 27 October". */
  day: string;
  /** The installer's 3 new days when offered in the same action; [] = they will follow. */
  newDays: ReadyCheckTimeSlot[];
  /** "21 November" — the end of the 30-day window after the safety check (null when unknown). */
  installBy: string | null;
  /** Secure My job link. */
  link: string;
  test?: boolean;
};

/** Idempotency keys: one text and one email per cancelled install booking. */
export const installNoAccessKeys = (bookingId: string) => ({ email: `install-no-access:v1:${bookingId}:email`, sms: `install-no-access:v1:${bookingId}:sms` });

/** DRAFT owner text (brand prefix added by brandSmsBody). Under 2 segments; STOP line last. */
export function installNoAccessText(f: Pick<InstallNoAccessFacts, "firstName" | "installerName" | "newDays" | "link">): string {
  const first = K.cleanName(f.firstName) ?? "there";
  const installer = f.installerName?.trim() || "your installer";
  const days = f.newDays.length ? `${installer} has offered ${f.newDays.length} new days – pick one here` : `${installer} will send you new days shortly – see your job`;
  return `Hi ${first}, we couldn't get in today for your insulation install. You're not charged anything. ${days}: ${f.link} Reply STOP to opt out.`;
}

const dayRow = (d: { day: string; time: string; href: string }, first: boolean) => {
  const border = first ? "" : "border-top:1px solid #E4E9F5;";
  return `<tr><td style="padding:12px 0;${border}"><a href="${esc(d.href)}" style="color:#22376B;text-decoration:none;"><strong>${esc(d.day)}</strong>${d.time ? `<br /><span class="muted">${esc(d.time)}</span>` : ""}</a></td><td align="right" style="padding:12px 0;${border}"><a href="${esc(d.href)}" style="color:#3C51C4;font-weight:700;text-decoration:none;white-space:nowrap;">Pick &#8250;</a></td></tr>`;
};

/** Owner email O65 (design docs/templates/mjml/owner_O65.mjml). */
export function renderInstallNoAccessEmail(f: InstallNoAccessFacts): { subject: string; html: string; text: string } {
  const first = K.cleanName(f.firstName) ?? "there";
  const installer = f.installerName?.trim() || "Your installer";
  const subject = `${first}, we couldn't get in today`;
  const headline = subject;
  const intro1 = `${installer} came for your install on ${f.day} but couldn't get in to do the work.`;
  const intro2 = "No problem. Nothing is charged for today, and your quote, rebate and deposit all stay exactly as they are.";
  const preview = "Nothing is charged for today. Your quote, rebate and deposit stay as they are.";
  const days = f.newDays.map((d) => ({ day: d.day, time: d.time, href: d.href || f.link }));
  const daysTitle = days.length ? "Pick a new install day" : "What happens next";
  const daysBody = days.length
    ? `${installer} has offered these days. Tap the one that suits you.`
    : `${installer} will send you three new days soon. You'll get an email with the days to tap, or you can suggest your own on your job page.`;
  const clock = f.installBy
    ? `Your install still needs to happen by <strong>${esc(f.installBy)}</strong>, 30 days after your safety check. After that, a new safety check would be needed. So please pick a day as soon as they come through.`
    : "Your install still needs to happen within 30 days of your safety check. So please pick a day as soon as they come through.";
  const daysPanel = days.length
    ? `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 6px">${esc(daysTitle)}</mj-text><mj-text padding="0 18px 4px">${esc(daysBody)}</mj-text><mj-table padding="0 18px 8px" font-size="16px">${days.map((d, n) => dayRow(d, n === 0)).join("")}</mj-table><mj-text mj-class="small" padding="0 18px 16px">None suit? <a href="${esc(f.link)}" style="color:#3C51C4;font-weight:700;">Suggest other days</a></mj-text></mj-column></mj-section>`
    : `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 6px">${esc(daysTitle)}</mj-text><mj-text padding="0 18px 16px">${esc(daysBody)}</mj-text></mj-column></mj-section>`;
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(intro1)}</mj-text><mj-text>${esc(intro2)}</mj-text></mj-column></mj-section>`,
    daysPanel,
    `<mj-section><mj-column mj-class="panel-amber"><mj-text mj-class="h2" padding="18px 18px 6px">The 30-day clock keeps running</mj-text><mj-text padding="0 18px 16px">${clock}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-button href="${esc(f.link)}" padding="18px 12px 18px">See my job</mj-button><mj-text mj-class="small" padding="0 12px">Questions? Just reply to this email.</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: f.test === true });
  const text = K.plainText([
    headline, "", intro1, intro2, "", daysTitle.toUpperCase(), daysBody, ...days.map((d) => `• ${d.day}${d.time ? ` ${d.time}` : ""}`), ...(days.length ? [`None suit? Suggest other days: ${f.link}`] : []), "", "THE 30-DAY CLOCK KEEPS RUNNING", K.stripTags(clock), "", `See my job: ${f.link}`, "", "Questions? Just reply to this email.",
  ], { testLabel: f.test === true });
  return { subject, html, text };
}
