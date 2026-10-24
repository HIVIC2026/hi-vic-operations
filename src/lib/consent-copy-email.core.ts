// Jo 24 Oct 2026 (decision 123): the ESC recommends giving the property owner a copy of the executed consent form, so
// once the AP representative has signed Part B the owner is emailed the filled form text. Wording is a DRAFT until Jo
// approves it in the template review; until then only TEST jobs receive it (real sends stay behind the switch). Pure.
import { simpleEmail } from "./simple-email.core";

export const CONSENT_COPY_EMAIL_APPROVED = false as boolean;

export type ConsentCopyInput = {
  firstName: string | null; installationDays: string[]; address: string; templateVersion: string;
  /** The executed form, rendered by consent.core renderConsentBody (one line per form line). */
  formText: string; sha256: string; myJobUrl: string | null; test?: boolean;
};

export function renderConsentCopyEmail(i: ConsentCopyInput) {
  const when = i.installationDays.join(", ") || "your install day";
  const subject = `Your signed consent form – ceiling insulation install ${when}`;
  const lines = [
    "Here is your copy of the consent form you signed so we can notify the Essential Services Commission about your ceiling insulation install, as the Victorian Energy Upgrades program requires.",
    `Install day(s): ${when}`,
    `Address: ${i.address}`,
    "Both signatures are on it: yours, and ours as the Accredited Person's representative. Keep it with your home records.",
    `Form (${i.templateVersion}):`,
    ...i.formText.split("\n"),
    `Record reference (SHA-256): ${i.sha256}`,
    "Questions? Just reply to this email.",
  ];
  const mail = simpleEmail(`Hi ${i.firstName?.trim() || "there"},`, lines, i.myJobUrl ? { label: "Open my job", url: i.myJobUrl } : undefined, { testLabel: i.test === true });
  return { subject, html: mail.html, text: mail.text };
}
