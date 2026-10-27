// Decision 292: the "O70 – New sender: homeowner enquiry page" email, with Jo's approved wording and the homeowner
// enquiry page (decision 387) as its one link (shown inline, no button). MJML refresh (Jo 27 Oct 2026):
// docs/templates/mjml/owner_O70.mjml — a short heading ("Hi {first}, thanks for getting in touch"), the eligibility/price link and Jo's 27 Oct sign-off (decision 413).
// Pure renderer: nothing is sent here. No unsubscribe link: this is a one-off reply to the sender's own email, never a
// campaign, and the sender has no job to opt out of.
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { WEBSITE_CALCULATOR_URL, newSenderReplyParagraphs, newSenderReplySubject } from "./new-sender-reply.core";

export type NewSenderReplyEmail = { subject: string; html: string; text: string };

const PREVIEW = "Check if your home is eligible for the insulation rebate and get a price estimate.";
const LINK_LABEL = WEBSITE_CALCULATOR_URL.replace(/^https?:\/\//, "");

export function renderNewSenderReplyEmail(i: { theirSubject: string | null; firstName: string | null; test?: boolean }): NewSenderReplyEmail {
  const p = newSenderReplyParagraphs(i.firstName);
  const heading = `${p.greeting.replace(/,$/, "")}, thanks for getting in touch`;
  const body = `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${K.esc(heading)}</mj-text>`
    + `<mj-text>${K.esc(p.linkLead)} <a href="${K.esc(WEBSITE_CALCULATOR_URL)}" style="color:#3C51C4;font-weight:700;">${K.esc(LINK_LABEL)}</a></mj-text>`
    + `<mj-text>${K.esc(p.next)}</mj-text><mj-text>${K.esc(p.cheers)}<br>${K.esc(p.signOff)}</mj-text></mj-column></mj-section>`;
  const subject = newSenderReplySubject(i.theirSubject);
  const html = mjEmail({ subject, preview: PREVIEW, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([heading, "", `${p.linkLead} ${WEBSITE_CALCULATOR_URL}`, "", p.next, "", p.cheers, p.signOff], { testLabel: i.test === true });
  return { subject, html, text };
}
