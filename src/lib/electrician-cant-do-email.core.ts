// New job flow, Part 6, Task 6: the installer office email when the electrician taps "Can't do this one" on their link.
// DRAFT wording (no approved wording yet): off for real jobs behind ELECTRICIAN_CANT_DO_EMAIL_APPROVED in
// electrician-link.core.ts; TEST jobs go to test-send. Own file so the link's pure core never pulls the email kit.
import { partnerEmailLayout, type PartnerBlock } from "./partner-email.core";
import { electricianCantDoEmailLine, electricianCantDoReasonLine } from "./electrician-link.core";

/** Suite look (Jo 5 Nov 2026): greeting line, big heading "{Electrician} can't do this one", what they said in a card, the
 *  "choose another electrician" line, one button to the job when the caller has its link. DRAFT words unchanged. */
export const ELECTRICIAN_CANT_DO_HEADING = (electrician: string) => `${electrician.trim()} can't do this one`;
export const ELECTRICIAN_CANT_DO_CHOOSE_LINE = "Choose another electrician on the job.";
export function electricianCantDoEmail(i: { jobNumber: string; electrician: string; reason: string; business?: string | null; jobUrl?: string | null; test: boolean }): { subject: string; html: string; text: string } {
  const line = electricianCantDoEmailLine(i);
  const hi = i.business?.trim() ? `Hi ${i.business.trim()},` : "Hi,";
  const blocks: PartnerBlock[] = [
    { kind: "hi", text: hi },
    { kind: "p", text: `Job ${i.jobNumber.trim()}: ${electricianCantDoReasonLine(i.reason)}` },
    { kind: "box", text: ELECTRICIAN_CANT_DO_CHOOSE_LINE },
    ...(i.jobUrl ? [{ kind: "button", label: "Open the job", url: i.jobUrl } as PartnerBlock] : []),
  ];
  const subject = `${i.jobNumber.trim()}: ${ELECTRICIAN_CANT_DO_HEADING(i.electrician)}`;
  const { html, text } = partnerEmailLayout({ subject, heading: ELECTRICIAN_CANT_DO_HEADING(i.electrician), preview: line, blocks, test: i.test });
  return { subject, html, text };
}
