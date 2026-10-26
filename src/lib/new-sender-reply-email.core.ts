// Decision 292: the "O70 – New sender: homeowner enquiry page" email, with Jo's approved wording and the homeowner
// enquiry page (decision 387) as its one link (shown inline, no button). MJML refresh (27 Oct 2026, not approved by Jo):
// docs/templates/mjml/owner_O70.mjml — a short heading ("Hi {first}, thanks for getting in touch") and "add your home".
// Pure renderer: nothing is sent here. No unsubscribe link: this is a one-off reply to the sender's own email, never a
// campaign, and the sender has no job to opt out of.
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { WEBSITE_CALCULATOR_URL, newSenderReplyParagraphs, newSenderReplySubject } from "./new-sender-reply.core";

export type NewSenderReplyEmail = { subject: string; html: string; text: string };

const PREVIEW = "To get started, add your home on our website. Spots are released in the order they are saved.";
const ADD_HOME = "To get started, please add your home on our website:";
const LINK_LABEL = WEBSITE_CALCULATOR_URL.replace(/^https?:\/\//, "");

export function renderNewSenderReplyEmail(i: { theirSubject: string | null; firstName: string | null; test?: boolean }): NewSenderReplyEmail {
  const p = newSenderReplyParagraphs(i.firstName);
  const heading = `${p.greeting.replace(/,$/, "")}, thanks for getting in touch`;
  const body = `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${K.esc(heading)}</mj-text>`
    + `<mj-text>${K.esc(ADD_HOME)} <a href="${K.esc(WEBSITE_CALCULATOR_URL)}" style="color:#3C51C4;font-weight:700;">${K.esc(LINK_LABEL)}</a></mj-text>`
    + `<mj-text>${K.esc(p.questions)}</mj-text><mj-text>${K.esc(p.reply)}</mj-text><mj-text>${K.esc(p.signOff)}</mj-text></mj-column></mj-section>`;
  const subject = newSenderReplySubject(i.theirSubject);
  const html = mjEmail({ subject, preview: PREVIEW, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([heading, "", `${ADD_HOME} ${WEBSITE_CALCULATOR_URL}`, "", p.questions, "", p.reply, "", p.signOff], { testLabel: i.test === true });
  return { subject, html, text };
}
