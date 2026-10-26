// Decision 296: O71 "Confirm your electrical safety check" (request) and its days-1/3 reminder variant. PURE renderer on the
// email kit; kept apart from piesa-owner-confirm.core.ts so the client screens that read the rules never bundle the kit.
// Design: docs/templates/mjml/owner_O71.mjml and owner_O71b.mjml (MJML email refresh, Jo 27 Oct 2026).
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { CEILING_ENTRY_WARNING, OUTCOME_LABEL, type PiesaOutcomeKind } from "./piesa-owner-confirm.core";

export type PiesaOwnerConfirmEmailInput = {
  firstName: string | null; assessmentDate: string; electricianLine: string; outcomeKind: PiesaOutcomeKind; confirmUrl: string; unsubscribeUrl: string | null;
  reminder: boolean; test?: boolean;
};
/** O71: the date, the electrician, the result, one button, the ceiling-entry warning and the 30-day rule. */
export function renderPiesaOwnerConfirmEmail(i: PiesaOwnerConfirmEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = i.reminder ? `${first}, your electrical safety check still needs your confirmation` : `${first}, please confirm your electrical safety check`;
  const outcome = OUTCOME_LABEL[i.outcomeKind];
  const what = `${i.electricianLine} did the electrical safety check (PIESA) at your home on`;
  const why = i.reminder
    ? "We can't book your install day until you've confirmed it. It's the owner part of the government form: you confirm the check was done, and we fill in the rest."
    : "The government form needs you to confirm the check was done. Tap the button, tick and type your name. About a minute.";
  const preview = i.reminder ? "We can't book your install day until you confirm. It takes about a minute." : `${i.electricianLine} ${i.outcomeKind === "all_clear" ? "gave your home the all clear" : "did your safety check"} on ${i.assessmentDate}. Confirming takes about a minute.`;
  const warn = "Please don't let anyone into the ceiling before the install.";
  // Jo 25 Oct 2026: remind the owner of the 30-day rule.
  const thirty = "Your install must be done within 30 days of this safety check. After 30 days it expires and a new safety check is needed.";
  const label = "Confirm my safety check";
  const wrong = "Something look wrong? Reply to this email before confirming.";
  // All clear in the green box; repairs needed / electrician on install day in the amber box.
  const clear = i.outcomeKind === "all_clear";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(subject)}</mj-text><mj-text>${esc(what)} <strong>${esc(i.assessmentDate)}</strong>.</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="${clear ? "panel-mint" : "panel-amber"}"><mj-text mj-class="eyebrow center" padding="18px 12px 6px">Result</mj-text><mj-text mj-class="center" font-family="Outfit, Figtree, Arial, Helvetica, sans-serif" font-size="22px" line-height="28px" font-weight="800" color="${clear ? "#057D40" : "#8A5200"}" padding="0 16px 18px">${esc(outcome)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="18px 12px 14px">${esc(why)}</mj-text><mj-button href="${esc(i.confirmUrl)}">${esc(label)}</mj-button></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-amber"><mj-text font-size="15px" line-height="23px" padding="18px 18px 10px">${esc(warn)} <strong>${esc(CEILING_ENTRY_WARNING)}</strong></mj-text><mj-text font-size="15px" line-height="23px" padding="0 18px 18px">${esc(thirty)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text mj-class="small" padding="14px 12px 0">${esc(wrong)}</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([subject, "", `${what} ${i.assessmentDate}.`, `Result: ${outcome}.`, "", why, "", `${label}: ${i.confirmUrl}`, "", `${warn} ${CEILING_ENTRY_WARNING}`, "", thirty, "", wrong], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
