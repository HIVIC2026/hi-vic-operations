// Decision 296: O71 "Confirm your electrical safety check" (request) and its days-1/3 reminder variant. PURE renderer on the
// email kit; kept apart from piesa-owner-confirm.core.ts so the client screens that read the rules never bundle the kit.
// DRAFT until Jo approves (docs/templates/drafts/O71-piesa-confirm.html, rendered by scripts/render-decision-296-drafts.ts).
import * as K from "./email-kit.core";
import { CEILING_ENTRY_WARNING, OUTCOME_LABEL, type PiesaOutcomeKind } from "./piesa-owner-confirm.core";

export type PiesaOwnerConfirmEmailInput = {
  firstName: string | null; assessmentDate: string; electricianLine: string; outcomeKind: PiesaOutcomeKind; confirmUrl: string; unsubscribeUrl: string | null;
  reminder: boolean; test?: boolean;
};
/** O71: the date, the electrician, the result, the ceiling-entry warning, one button. */
export function renderPiesaOwnerConfirmEmail(i: PiesaOwnerConfirmEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = i.reminder ? `${first}, your electrical safety check still needs your confirmation` : `${first}, please confirm your electrical safety check`;
  const outcome = OUTCOME_LABEL[i.outcomeKind];
  const what = (strong: boolean) => `${i.electricianLine} completed the electrical safety check (PIESA) at your home on ${strong ? K.strong(i.assessmentDate) : i.assessmentDate}. Result: ${strong ? K.strong(outcome) : outcome}.`;
  const why = i.reminder
    ? "We can't book your install day until you've confirmed it. It's the government form's owner declaration — you confirm the check was done, we fill in the rest."
    : "The government form needs you to confirm the check was done. Tap the button, enter the 6-digit code we text you, tick and type your name. About a minute.";
  const warn = (strong: boolean) => `Please don't let anyone into the ceiling before the install: ${strong ? K.strong(CEILING_ENTRY_WARNING) : CEILING_ENTRY_WARNING}`;
  const label = "Confirm my safety check";
  const wrong = "Something look wrong? Reply to this email before confirming.";
  const body = [K.h1(subject, 8), K.p(what(true), "0 0 14px", true), K.p(why, "0 0 14px"), K.p(warn(true), "0 0 14px", true), K.button(i.confirmUrl, label, "6px 0 4px"), K.small(wrong, "14px 0 0", { size: 14 })].join("\n");
  const html = K.emailShell({ body, previewText: null, testLabel: i.test === true, unsubscribe: i.unsubscribeUrl });
  const text = K.plainText([subject, "", what(false), "", why, "", warn(false), "", `${label}: ${i.confirmUrl}`, "", wrong], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
