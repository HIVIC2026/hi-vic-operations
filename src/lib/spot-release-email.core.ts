// Decision 389: O77 "It's your turn — confirm your free Ready Check" (and its day-2 reminder). PURE renderer; kept apart
// from spot-release.core.ts so the owner page that reads the rules never bundles the email code.
// Approved by Jo 25 Oct 2026 (SPOT_RELEASED_APPROVED = true, decision 389); MJML refresh 27 Oct 2026 (not approved by Jo):
// docs/templates/mjml/owner_O77.mjml (Confirm button above the steps, intro reworded to read without "Press here").
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { CONFIRM_BUTTON, SPOT_RELEASED_REMINDER_SUBJECT, SPOT_RELEASED_SUBJECT, WHAT_HAPPENS_NEXT } from "./spot-release.core";

export type SpotReleasedEmailInput = { firstName: string | null; confirmUrl: string; unsubscribeUrl: string | null; reminder: boolean; test?: boolean };

const HEADING = "Confirm your free Ready Check";
const INTRO = "Press Confirm to tell us you'd still like your free Ready Check. One of our EEC-certified installers will then be in touch.";
const PREVIEW = "Press Confirm and one of our EEC-certified installers will be in touch.";
const STEPS_TITLE = WHAT_HAPPENS_NEXT.title.replace(/:$/, "");

/** O77: greeting, heading, the Confirm line and button, then "What happens next" (Jo-approved steps, word for word). */
export function renderSpotReleasedEmail(i: SpotReleasedEmailInput) {
  const first = K.cleanName(i.firstName);
  const subject = i.reminder ? SPOT_RELEASED_REMINDER_SUBJECT : SPOT_RELEASED_SUBJECT;
  const hi = `Hi${first ? ` ${first}` : ""}, ${i.reminder ? "just checking — " : ""}it's your turn!`;
  const steps = WHAT_HAPPENS_NEXT.steps;
  const stepHtml = (s: string) => K.esc(s).replace(/^Press Confirm\./, `Press <strong>${K.esc(CONFIRM_BUTTON)}</strong>.`);
  const rows = steps.map((s, n) => { const pad = n === steps.length - 1 ? 12 : 14; return `<tr><td width="34" valign="top" style="padding:1px 0 ${pad}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${pad}px;">${stepHtml(s)}</td></tr>`; }).join("");
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${K.esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(HEADING)}</mj-text><mj-text>${K.esc(INTRO)}</mj-text><mj-button href="${K.esc(i.confirmUrl)}">${K.esc(CONFIRM_BUTTON)}</mj-button></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">${K.esc(STEPS_TITLE)}</mj-text><mj-table padding="0 18px 6px">${rows}</mj-table></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: PREVIEW, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([
    hi, "", HEADING, INTRO, `${CONFIRM_BUTTON}: ${i.confirmUrl}`, "", STEPS_TITLE.toUpperCase(), ...steps.map((s, n) => `${n + 1}. ${s}`),
  ], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
