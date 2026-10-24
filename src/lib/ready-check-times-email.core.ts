// Jo 24 Oct 2026 (decisions 52–53): when the installer offers Ready Check times, the owner gets a link to pick one.
// Wording is a DRAFT until Jo approves it in the template review; until then only TEST jobs receive it. Pure.
import { simpleEmail } from "./simple-email.core";

export const READY_CHECK_TIMES_EMAIL_APPROVED = false as boolean;

export type ReadyCheckTimesInput = { firstName: string | null; times: string[]; installerName: string | null; myJobUrl: string; test?: boolean };

export function renderReadyCheckTimesEmail(i: ReadyCheckTimesInput) {
  const subject = "Choose a time for your free Ready Check";
  const lines = [
    `${i.installerName ? `${i.installerName}, your installer,` : "Your installer"} can come for your free Ready Check at any of these times:`,
    ...i.times.map((t) => `• ${t}`),
    "Tap the button to pick one. If none suit, you can suggest other days and your installer will pick a time.",
    "Questions? Just reply to this email.",
  ];
  const mail = simpleEmail(`Hi ${i.firstName?.trim() || "there"},`, lines, { label: "Choose a time", url: i.myJobUrl }, { testLabel: i.test === true });
  return { subject, html: mail.html, text: mail.text };
}
