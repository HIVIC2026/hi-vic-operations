// Jo 24 Oct 2026 (decision 4): email the installer when the owner accepts the quote. Wording approved by Jo, with her
// change: the owner chooses several days that suit and the installer either accepts one or suggests another.
// Pure. No prices: trades never see the owner's price.
import { simpleEmail } from "./simple-email.core";

export const INSTALLER_ACCEPTED_EMAIL_APPROVED = true as boolean;

export function renderInstallerAcceptedEmail(i: { installerFirstName: string | null; ownerName: string | null; address: string | null; jobNumber: string; jobUrl: string; test?: boolean }) {
  const owner = i.ownerName?.trim() || "The owner";
  const first = owner.split(/\s+/)[0] ?? owner;
  const where = i.address?.trim() || "the property";
  const subject = `Owner accepted – ${i.jobNumber}${i.address?.trim() ? `, ${i.address.trim()}` : ""}`;
  const lines = [
    `Good news – ${owner} has accepted the quote for ${where} (${i.jobNumber}).`,
    "What happens next",
    `1. ${first} pays the $349 electrical safety check.`,
    `2. We arrange the licensed electrician and ${first} picks a time. You don't need to do anything for this.`,
    `3. Once the safety check is done, ${first} chooses several days that work for them. You'll see them in your portal: accept one, or if none of them suit, suggest another day and we'll sort it out with ${first}. The install must happen within 30 days of the safety check.`,
  ];
  const mail = simpleEmail(`Hi ${i.installerFirstName?.trim() || "there"},`, lines, { label: "Open the job in the portal", url: i.jobUrl }, { testLabel: i.test === true });
  return { subject, html: mail.html, text: mail.text };
}
