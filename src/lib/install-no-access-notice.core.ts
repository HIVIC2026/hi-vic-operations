// Decision 215 (Jo, 24 Oct 2026): after an install-day "Couldn't get in?" the owner gets a text + email at once —
// "We couldn't get in today". If the installer's three new days are already offered they are included; otherwise the
// email says the installer will send new days (the normal install-days email O33 follows). Nobody is charged, the
// 30-day clock keeps running and the email states the end date. The office is alerted only on the SECOND no-access on
// the same job (decision 214 alert path, `needs_office` on the trade_couldnt_get_in event).
// DRAFT wording (not yet approved by Jo): text type `install_no_access` has wordingApproved=false, the email flag below
// is false — TEST jobs still see both through test-send. Design draft: docs/templates/owner/O65-install-no-access.html.
import * as K from "./email-kit.core";
import type { ReadyCheckTimeSlot } from "./ready-check-times-email.core";

/** Flip to true only when Jo approves the O65 wording (and the SMS type in sms.core at the same time). */
export const INSTALL_NO_ACCESS_NOTICE_APPROVED = true as boolean; // Jo approved the text + O65 email wording 24 Oct 2026 (decision 217)
export const INSTALL_NO_ACCESS_SMS_TYPE = "install_no_access";
/** Recorded once per cancelled install booking BEFORE anything is sent, so a retry never repeats the notice. */
export const INSTALL_NO_ACCESS_NOTICE_EVENT = "install_no_access_owner_notice";

/** Decision 215: the office is alerted on the second no-access on the same job, not the first. */
export function installNoAccessAlertsOffice(priorInstallNoAccessCount: number): boolean {
  return priorInstallNoAccessCount >= 1;
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

/** DRAFT owner email O65. */
export function renderInstallNoAccessEmail(f: InstallNoAccessFacts): { subject: string; html: string; text: string } {
  const first = K.cleanName(f.firstName) ?? "there";
  const installer = f.installerName?.trim() || "Your installer";
  const subject = `${first}, we couldn't get in today`;
  const headline = subject;
  const intro = `${installer} came for your install on ${f.day} but couldn't get in to do the work. No problem — nothing is charged for today, and your quote, rebate and deposit all stay exactly as they are.`;
  const daysTitle = f.newDays.length ? "Pick a new install day" : "What happens next";
  const daysBody = f.newDays.length
    ? `${installer} has offered these days. Tap the one that suits you.`
    : `${installer} will send you three new days shortly. You'll get an email with the days to tap, or you can suggest your own from your job page.`;
  const clock = f.installBy
    ? `Your install still needs to happen by <strong>${K.esc(f.installBy)}</strong> — that's 30 days after your safety check. After that date a new safety check would be needed, so please pick a day as soon as they come through.`
    : "Your install still needs to happen within 30 days of your safety check, so please pick a day as soon as they come through.";
  const body = [
    K.h1(headline),
    K.p(intro),
    K.sectionTitle(daysTitle),
    K.p(daysBody),
    f.newDays.length ? K.tapTimeButtons(f.newDays.map((d) => ({ day: d.day, time: d.time, href: d.href || f.link })), { href: f.link }) : K.button(f.link, "See my job"),
    K.mistBox("The 30-day clock keeps running", `<div style="font-size:14px;color:${K.KIT.NAVY};line-height:1.55;">${clock}</div>`, { padding: "14px 16px", radius: 14, marginTop: 16 }),
    K.small("Questions? Just reply to this email."),
  ].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: f.test === true, unsubscribe: null });
  const text = K.plainText([
    headline, "", intro, "", daysTitle.toUpperCase(), daysBody, ...f.newDays.map((d) => `• ${d.day}${d.time ? ` ${d.time}` : ""}`), `See my job: ${f.link}`, "", "THE 30-DAY CLOCK KEEPS RUNNING", K.stripTags(clock), "", "Questions? Just reply to this email.",
  ], { testLabel: f.test === true });
  return { subject, html, text };
}
