// Decision 186 (Jo, 24 Oct 2026): the moment electrical clearance becomes valid (PIESA passed with no fixes, or the
// fixes are completed and Section C is signed — allocation.core `electricalClearance`), the assigned installer business
// gets ONE text and ONE email: offer the owner 3 install days before the 30-day deadline. Pure wording + keys only.
// Design approved: docs/templates/installer/I65-install-clearance.html (partner kit, 30-day box of decision 137, AP footer).
// The text is the decision's wording verbatim (one-off partner job text, same shape as `job_offer`: no STOP line).
import * as K from "./email-kit.core";

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
  return new Date(`${deadlineYmd.slice(0, 10)}T12:00:00+10:00`).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "long", year: "numeric" });
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

/** I65: "{HV} is cleared for install" — one line, the approved 30-day box, "Offer install days", AP footer. No prices. */
export function renderInstallClearanceEmail(i: InstallClearanceEmailInput) {
  const owner = K.cleanName(i.ownerFirstName) ?? "the owner";
  const subject = `${i.jobNumber} is cleared for install – offer 3 install days by ${i.deadlineLabel}`;
  const headline = `${i.jobNumber} is cleared for install`;
  const line = `The electrical safety check is done${i.fixesSignedOff ? ", and the fixes are signed off" : ""}. Offer ${owner} three install days with arrival times from your job page.`;
  const body = [
    K.h1(headline, 8),
    K.p(line),
    K.thirtyDayClockBox({ kind: "safety_check" }),
    K.button(i.jobUrl, "Offer install days"),
  ].join("\n");
  const html = K.emailShell({ body, previewText: line, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([headline, "", line, "", K.THIRTY_DAY_CLOCK_TEXT(), "", `Offer install days: ${i.jobUrl}`], { testLabel: i.test === true });
  return { subject, html, text };
}
