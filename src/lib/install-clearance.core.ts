// Decision 186 (Jo, 24 Oct 2026): the moment electrical clearance becomes valid (PIESA passed with no fixes, or the
// fixes are completed and Section C is signed — allocation.core `electricalClearance`), the assigned installer business
// gets ONE text and ONE email: offer the owner 3 install days before the 30-day deadline. Pure wording + keys only.
// Design approved: docs/templates/mjml/installer_I65.mjml (MJML refresh, Jo 26 Oct 2026: the 30-day box written to the installer, with the deadline).
// The text is the decision's wording verbatim (one-off partner job text, same shape as `job_offer`: no STOP line).
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { melbourneMidnight } from "./daily-brief.core";

export const INSTALL_CLEARANCE_EMAIL_APPROVED = true as boolean;
export const INSTALL_CLEARANCE_SMS_TYPE = "install_clearance" as const;
/** Recorded ONCE per job + clearance timing date BEFORE anything is sent (details: { timing_date, basis }). */
export const INSTALL_CLEARANCE_EVENT = "install_clearance_notified" as const;

/** Idempotency keys: one text and one email per job per clearance timing date (a repeat PIESA = a new clearance). */
export function installClearanceKeys(jobId: string, timingDate: string) {
  const base = `install-clearance:v1:${jobId}:${timingDate.slice(0, 10)}`;
  return { email: `${base}:email`, sms: `${base}:sms` };
}

/** "23 November 2026" for a Melbourne calendar date (YYYY-MM-DD) — the install window deadline. */
export function installClearanceDeadlineLabel(deadlineYmd: string): string {
  return new Date(melbourneMidnight(deadlineYmd.slice(0, 10))).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" });
}

export type InstallClearanceTextFacts = { jobNumber: string; deadlineLabel: string; link: string };

/** Decision 186 wording (the brand prefix is added by `brandSmsBody`). */
export function installClearanceText(f: InstallClearanceTextFacts): string {
  return `${f.jobNumber} is cleared for install (safety check done). Offer the owner 3 install days by ${f.deadlineLabel}: ${f.link}`;
}

export type InstallClearanceEmailInput = {
  jobNumber: string;
  ownerFirstName: string | null;
  /** Section C path: the fixes were completed and signed off. */
  fixesSignedOff: boolean;
  deadlineLabel: string;
  jobUrl: string;
  test?: boolean;
};

/** I65: "{HV} is cleared for install" — one line, "Offer install days", the installer's 30-day box, AP footer. No prices. */
export function renderInstallClearanceEmail(i: InstallClearanceEmailInput) {
  const owner = K.cleanName(i.ownerFirstName) ?? "the owner";
  const subject = `${i.jobNumber} is cleared for install – offer 3 install days by ${i.deadlineLabel}`;
  const headline = `${i.jobNumber} is cleared for install`;
  const line = `The electrical safety check is done${i.fixesSignedOff ? ", and the fixes are signed off" : ""}. Offer ${owner} three install days with arrival times from your job page.`;
  const clock = `The install must happen within 30 days of this safety check (by ${i.deadlineLabel}). After 30 days the check expires and has to be done again, and a new check may be charged.`;
  const soon = "So please offer install days as soon as you can.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(headline)}</mj-text><mj-text>${esc(line)}</mj-text><mj-button href="${esc(i.jobUrl)}">Offer install days</mj-button></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-amber"><mj-text mj-class="h2" padding="18px 18px 6px">&#9200; The 30-day clock</mj-text><mj-text padding="0 18px 10px">${esc(clock)}</mj-text><mj-text padding="0 18px 18px">${esc(soon)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview: `Offer ${owner} three install days with arrival times from your job page.`, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([headline, "", line, "", `Offer install days: ${i.jobUrl}`, "", `The 30-day clock: ${clock} ${soon}`], { testLabel: i.test === true });
  return { subject, html, text };
}
