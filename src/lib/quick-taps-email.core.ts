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
