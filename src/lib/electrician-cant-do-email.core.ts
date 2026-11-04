// New job flow, Part 6, Task 6: the installer office email when the electrician taps "Can't do this one" on their link.
// DRAFT wording (no approved wording yet): off for real jobs behind ELECTRICIAN_CANT_DO_EMAIL_APPROVED in
// electrician-link.core.ts; TEST jobs go to test-send. Own file so the link's pure core never pulls the email kit.
import { partnerEmailLayout } from "./partner-email.core";
import { electricianCantDoEmailLine, electricianCantDoReasonLine } from "./electrician-link.core";

export function electricianCantDoEmail(i: { jobNumber: string; electrician: string; reason: string; test: boolean }): { subject: string; html: string; text: string } {
  const line = electricianCantDoEmailLine(i);
  const { html, text } = partnerEmailLayout({ subject: line, blocks: [{ kind: "p", text: line }, { kind: "p", text: electricianCantDoReasonLine(i.reason) }], test: i.test });
  return { subject: line, html, text };
}
