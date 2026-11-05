// The three installer-office emails for an installer's OWN job's safety check (to book / can't do / not booked yet), in the
// suite look (Jo 5 Nov 2026). Own file: own-job-electrician-link.core.ts is on the electrician's /e/ page bundle and must not
// pull the email kit. Jo's words (3 Nov 2026) unchanged.
import { jobDetails, partnerHi, type PartnerBlock, type PartnerJobFacts } from "./partner-email.core";
import type { PiesaBooker } from "./piesa-booker.core";

/** One installer-office email in the suite look (Jo 5 Nov 2026): the subject, a heading taken from it, Jo's approved lines (3 Nov 2026,
 *  unchanged), the action line (also hers) in a box, and the plain text the record keeps. The sender adds the greeting, the job card
 *  and the Open the job button. */
export type OfficeEmail = { subject: string; heading: string; lines: string[]; action: string; text: string };
const officeEmail = (subject: string, heading: string, lines: string[], action: string, jobUrl: string): OfficeEmail =>
  ({ subject, heading, lines, action, text: `${[...lines, action].join("\n")}\nJob page: ${jobUrl}` });

/** The installer office: this job's safety check is ready to book. */
export function officeToBookEmail(i: { address: string; electrician: string; booker: PiesaBooker; jobUrl: string }): OfficeEmail {
  const who = i.booker === "office" ? "Please call the owner and book it within 2 business days."
    : i.booker === "electrician" ? `We've sent ${i.electrician} a link to call the owner and book it within 2 business days.`
    : `We've sent ${i.electrician} a link too. Whoever books first, within 2 business days.`;
  return officeEmail(`Safety check to book for ${i.address}`, "Safety check to book", ["The owner has paid."], who, i.jobUrl);
}

/** The installer office: the electrician can't do this one. */
export function officeCantDoEmail(i: { address: string; electrician: string; reason: string; jobUrl: string }): OfficeEmail {
  return officeEmail(`${i.electrician} can't do the safety check for ${i.address}`, `${i.electrician} can't do the safety check`, [`Reason: ${i.reason}.`], "Pick another electrician on the job page.", i.jobUrl);
}

/** The installer office: 2 business days passed and the safety check still isn't booked. */
export function officeNotBookedEmail(i: { address: string; jobUrl: string }): OfficeEmail {
  return officeEmail("Not booked yet — book it or pick another electrician", "Not booked yet", [`The safety check (PIESA) at ${i.address} isn't booked yet.`], "Book it on the job page, or pick another electrician.", i.jobUrl);
}

/** The blocks every installer-office email is laid out from (partnerEmailLayout): greeting, the job card, Jo's lines, the action
 *  box, the button. */
export function officeEmailBlocks(m: OfficeEmail, contactName: string | null, job: PartnerJobFacts | null, jobUrl: string | null): PartnerBlock[] {
  return [
    partnerHi(contactName),
    ...(job ? [jobDetails(job)] : []),
    ...m.lines.map((t): PartnerBlock => ({ kind: "p", text: t })),
    { kind: "box", text: m.action },
    ...(jobUrl ? [{ kind: "button", label: "Open the job", url: jobUrl } as PartnerBlock] : []),
  ];
}
