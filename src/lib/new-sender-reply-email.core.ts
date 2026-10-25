// Decision 292: the "O70 – New sender: start on the calculator" email, plain, in the shared kit design (logo card,
// AP/ABN footer), with Jo's approved wording from new-sender-reply.core verbatim and the website calculator as its one
// link (shown inline, no button, no heading: nothing beyond the approved words). The sample in
// docs/templates/owner/O70-new-sender-calculator.html is written by scripts/render-decision-292-sample.ts.
// Pure renderer: nothing is sent here. No unsubscribe link: this is a one-off reply to the sender's own email, never a
// campaign, and the sender has no job to opt out of.
import * as K from "./email-kit.core";
import { WEBSITE_CALCULATOR_URL, newSenderReplyParagraphs, newSenderReplySubject, newSenderReplyText } from "./new-sender-reply.core";

export type NewSenderReplyEmail = { subject: string; html: string; text: string };

export function renderNewSenderReplyEmail(i: { theirSubject: string | null; firstName: string | null; test?: boolean }): NewSenderReplyEmail {
  const p = newSenderReplyParagraphs(i.firstName);
  const at = p.calculator.indexOf(WEBSITE_CALCULATOR_URL);
  const calculatorHtml = `${K.esc(p.calculator.slice(0, at))}${K.link(WEBSITE_CALCULATOR_URL, WEBSITE_CALCULATOR_URL)}${K.esc(p.calculator.slice(at + WEBSITE_CALCULATOR_URL.length))}`;
  const body = [
    K.greeting(p.greeting),
    K.p(`${K.esc(p.thanks)} ${calculatorHtml}`, "0 0 16px", true),
    K.p(p.questions),
    K.p(p.reply),
    K.p(p.signOff, "0"),
  ].join("\n");
  const subject = newSenderReplySubject(i.theirSubject);
  const html = K.emailShell({ body, previewText: null, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([newSenderReplyText(i.firstName)], { testLabel: i.test === true });
  return { subject, html, text };
}
