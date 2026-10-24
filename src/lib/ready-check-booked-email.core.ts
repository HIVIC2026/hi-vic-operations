// Jo 24 Oct 2026 (decision 80): on our leads the owner gets "You're booked" for the free Ready Check, and an updated one
// when either side changes the time. Our leads only (installers' own customers have no portal booking). Wording is a
// DRAFT until Jo approves it in the template review; until then only TEST jobs receive it. Pure.
import { simpleEmail } from "./simple-email.core";

export const READY_CHECK_BOOKED_EMAIL_APPROVED = false as boolean;
/** The matching "You're booked" text has no approved wording or SMS type yet: never sent. */
export const READY_CHECK_BOOKED_TEXT_APPROVED = false as boolean;

export type ReadyCheckBookedInput = { firstName: string | null; when: string; installerName: string | null; changed: boolean; myJobUrl: string; test?: boolean };

export function renderReadyCheckBookedEmail(i: ReadyCheckBookedInput) {
  const subject = i.changed ? `Your Ready Check time has changed – ${i.when}` : `You're booked: free Ready Check – ${i.when}`;
  const lines = [
    i.changed ? "Your free Ready Check has a new time." : "Your free Ready Check is booked.",
    `When: ${i.when}`,
    ...(i.installerName ? [`Installer: ${i.installerName}`] : []),
    "At your Ready Check the installer checks your ceiling, measures up and confirms whether you qualify. Please have an adult (18+) home and clear the area under the ceiling hatch.",
    "Need to change the time? Use Change time on your job page.",
    "Questions? Just reply to this email.",
  ];
  const mail = simpleEmail(`Hi ${i.firstName?.trim() || "there"},`, lines, { label: "Open my job", url: i.myJobUrl }, { testLabel: i.test === true });
  return { subject, html: mail.html, text: mail.text };
}
