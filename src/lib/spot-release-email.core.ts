// Decision 389: O77 "It's your turn — confirm your free Ready Check" (and its day-2 reminder). PURE renderer; kept apart
// from spot-release.core.ts so the owner page that reads the rules never bundles the email code.
// Approved by Jo 25 Oct 2026 (SPOT_RELEASED_APPROVED = true, decision 389); MJML refresh 27 Oct 2026:
// docs/templates/mjml/owner_O77.mjml (Confirm button above the steps, intro reworded to read without "Press here").
// Two wordings: renderSpotReleasedEmail = decisions #21/#22 (area batch Send, opens the quick taps); renderLegacySpotReleasedEmail
// = the 25 Oct wording, unchanged, for the old Release path only (fix round 1, controller ruling 2 Nov 2026).
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { CONFIRM_BUTTON, LEGACY_CONFIRM_BUTTON, LEGACY_WHAT_HAPPENS_NEXT, SPOT_RELEASED_REMINDER_SUBJECT, SPOT_RELEASED_SUBJECT, WHAT_HAPPENS_NEXT } from "./spot-release.core";

export type SpotReleasedEmailInput = { firstName: string | null; confirmUrl: string; unsubscribeUrl: string | null; reminder: boolean; test?: boolean };

const HEADING = "Confirm your free Ready Check";
type Wording = { intro: string; preview: string; button: string; steps: { title: string; steps: readonly string[] }; stepHtml: (s: string) => string };
/** Decisions #21/#22 (Jo 2 Nov 2026): the area batch Send + its day-2 reminder; the button opens the quick taps. */
const V2: Wording = {
  intro: "Answer a few quick questions so we can book your free Ready Check. Just tap, it takes under a minute.",
  preview: "Answer a few quick questions so we can book your free Ready Check.",
  button: CONFIRM_BUTTON, steps: WHAT_HAPPENS_NEXT,
  stepHtml: (s) => K.esc(s).replace(CONFIRM_BUTTON, `<strong>${K.esc(CONFIRM_BUTTON)}</strong>`),
};
/** LEGACY (decision 389, Jo 25 Oct 2026; MJML refresh 27 Oct), byte for byte as at fc2a8a3: only the old Release path. */
const LEGACY: Wording = {
  intro: "Press Confirm to tell us you'd still like your free Ready Check. One of our EEC-certified installers will then be in touch.",
  preview: "Press Confirm and one of our EEC-certified installers will be in touch.",
  button: LEGACY_CONFIRM_BUTTON, steps: LEGACY_WHAT_HAPPENS_NEXT,
  stepHtml: (s) => K.esc(s).replace(/^Press Confirm\./, `Press <strong>${K.esc(LEGACY_CONFIRM_BUTTON)}</strong>.`),
};

/** O77: greeting, heading, the Confirm line and button, then "What happens next" (Jo-approved steps, word for word). */
function render(w: Wording, i: SpotReleasedEmailInput) {
  const first = K.cleanName(i.firstName);
  const subject = i.reminder ? SPOT_RELEASED_REMINDER_SUBJECT : SPOT_RELEASED_SUBJECT;
  const hi = `Hi${first ? ` ${first}` : ""}, ${i.reminder ? "just checking — " : ""}it's your turn!`;
  const stepsTitle = w.steps.title.replace(/:$/, "");
  const steps = w.steps.steps;
  const rows = steps.map((s, n) => { const pad = n === steps.length - 1 ? 12 : 14; return `<tr><td width="34" valign="top" style="padding:1px 0 ${pad}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${pad}px;">${w.stepHtml(s)}</td></tr>`; }).join("");
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${K.esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${K.esc(HEADING)}</mj-text><mj-text>${K.esc(w.intro)}</mj-text><mj-button href="${K.esc(i.confirmUrl)}">${K.esc(w.button)}</mj-button></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">${K.esc(stepsTitle)}</mj-text><mj-table padding="0 18px 6px">${rows}</mj-table></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: w.preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([
    hi, "", HEADING, w.intro, `${w.button}: ${i.confirmUrl}`, "", stepsTitle.toUpperCase(), ...steps.map((s, n) => `${n + 1}. ${s}`),
  ], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
/** O77 as sent by the area batch Send (decisions #21/#22, behind IT_IS_YOUR_TURN_V2_APPROVED). */
export const renderSpotReleasedEmail = (i: SpotReleasedEmailInput) => render(V2, i);
/** O77 as Jo approved it for the old Release step (25 Oct 2026) — releases already made keep this wording. */
export const renderLegacySpotReleasedEmail = (i: SpotReleasedEmailInput) => render(LEGACY, i);
