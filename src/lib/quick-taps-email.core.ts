// A48 batch 2: the owner's email after a quick-taps decline (no roof access / built or ceiling replaced in the last 5
// years / no thanks). PURE renderer; kept apart from quick-taps.core.ts so the owner page never bundles the email code.
// The body line is Jo's approved wording (spec part 1, "screen + email"), verbatim. Subject "Your free Ready Check" and
// greeting "Hi {first name}," / "Hi there," approved by Jo 30 Oct 2026.
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { QUICK_TAPS_COPY, type FinalOutcome } from "./quick-taps.core";

export const QUICK_TAPS_DECLINE_SUBJECT = "Your free Ready Check";

export function renderQuickTapsDeclineEmail(i: { outcome: Exclude<FinalOutcome, "pass">; firstName: string | null; unsubscribeUrl: string | null; test?: boolean }) {
  const first = K.cleanName(i.firstName);
  const hi = `Hi ${first ?? "there"},`; // Jo approved: "Hi {first name}," — none on file → "Hi there,"
  const line = QUICK_TAPS_COPY.outcome[i.outcome];
  const subject = QUICK_TAPS_DECLINE_SUBJECT;
  const body = `<mj-section><mj-column><mj-text mj-class="hi">${K.esc(hi)}</mj-text><mj-text>${K.esc(line)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview: line, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([hi, "", line], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}

// Jo 2 Nov 2026: the owner's email with the quick taps link (sent with the quick taps text), plus the day-2 reminder.
export const QUICK_TAPS_EMAIL_SUBJECT = "It's almost time for your free Ready Check";
export const QUICK_TAPS_REMINDER_EMAIL_SUBJECT = "Just a reminder - confirm your details";
export const QUICK_TAPS_EMAIL_BUTTON = "Confirm my details";
const SIGN_OFF = "Home Insulation Victoria";

export function renderQuickTapsEmail(i: { firstName: string | null; link: string; unsubscribeUrl: string | null; reminder: boolean; test?: boolean }) {
  const first = K.cleanName(i.firstName);
  const subject = i.reminder ? QUICK_TAPS_REMINDER_EMAIL_SUBJECT : QUICK_TAPS_EMAIL_SUBJECT;
  const line = i.reminder
    ? `Hi ${first ?? "there"}, just a reminder - please confirm a few quick details so we can book your free Ready Check.`
    : `Hi ${first ?? "there"}, great news - it's almost time for your free Ready Check! Please confirm a few quick details for your quote.`;
  const body = `<mj-section><mj-column><mj-text>${K.esc(line)}</mj-text><mj-button href="${K.esc(i.link)}">${K.esc(QUICK_TAPS_EMAIL_BUTTON)}</mj-button><mj-text>${K.esc(SIGN_OFF)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview: line, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([line, "", `${QUICK_TAPS_EMAIL_BUTTON}: ${i.link}`, "", SIGN_OFF], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
