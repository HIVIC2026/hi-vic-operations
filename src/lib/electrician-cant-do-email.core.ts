// New job flow, Part 6, Task 6: the installer office email when the electrician taps "Can't do this one" on their link.
// DRAFT wording (no approved wording yet): off for real jobs behind ELECTRICIAN_CANT_DO_EMAIL_APPROVED in
// electrician-link.core.ts; TEST jobs go to test-send. Own file so the link's pure core never pulls the email kit.
import { jobDetails, partnerEmailLayout, partnerHi, type PartnerBlock } from "./partner-email.core";
import { electricianCantDoEmailLine, electricianCantDoReasonLine } from "./electrician-link.core";

/** Suite look (Jo 5 Nov 2026): greeting, the DRAFT heading "{Electrician} can't do this one", the job card (job, address, owner,
 *  mobile, electrician, what they said), the DRAFT "Choose another electrician on the job." line in a box, the job button. */
export const ELECTRICIAN_CANT_DO_HEADING = (electrician: string) => `${electrician.trim()} can't do this one`;
export const ELECTRICIAN_CANT_DO_CHOOSE_LINE = "Choose another electrician on the job.";
export function electricianCantDoEmail(i: { jobNumber: string; electrician: string; reason: string; contactName?: string | null; address?: string | null; owner?: string | null; mobile?: string | null; jobUrl?: string | null; test: boolean }): { subject: string; html: string; text: string } {
  const line = electricianCantDoEmailLine(i);
  const blocks: PartnerBlock[] = [
    partnerHi(i.contactName),
    jobDetails({ jobNumber: i.jobNumber, address: i.address, owner: i.owner, mobile: i.mobile }, [["Electrician", i.electrician], ["They said", i.reason.trim()]]),
    { kind: "box", text: ELECTRICIAN_CANT_DO_CHOOSE_LINE },
    ...(i.jobUrl ? [{ kind: "button", label: "Choose a different electrician", url: i.jobUrl } as PartnerBlock] : []), // Jo 5 Nov 2026: the button names the action and lands on it
  ];
  const subject = `${i.jobNumber.trim()}: ${ELECTRICIAN_CANT_DO_HEADING(i.electrician)}`;
  const { html, text } = partnerEmailLayout({ subject, heading: ELECTRICIAN_CANT_DO_HEADING(i.electrician), preview: line, blocks, test: i.test });
  return { subject, html, text };
}
