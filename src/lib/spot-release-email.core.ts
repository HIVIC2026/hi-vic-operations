// Decision 389: O77 "It's your turn — confirm your free Ready Check" (and its day-2 reminder). PURE renderer on the email
// kit; kept apart from spot-release.core.ts so the owner page that reads the rules never bundles the kit.
// DRAFT until Jo sees the rendered picture (SPOT_RELEASED_APPROVED = false): docs/templates/drafts/O77-spot-released.html,
// preview docs/designs/O77.jpg (scripts/render-decision-389-drafts.ts --jpg).
import * as K from "./email-kit.core";
import { CONFIRM_BUTTON, SPOT_RELEASED_LINE, SPOT_RELEASED_REMINDER_LINE, SPOT_RELEASED_REMINDER_SUBJECT, SPOT_RELEASED_SUBJECT, WHAT_HAPPENS_NEXT } from "./spot-release.core";

export type SpotReleasedEmailInput = { firstName: string | null; confirmUrl: string; unsubscribeUrl: string | null; reminder: boolean; test?: boolean };

/** O77: greeting, Jo's line, "What happens next" (Jo-approved, word for word), one Confirm button. */
export function renderSpotReleasedEmail(i: SpotReleasedEmailInput) {
  const first = K.cleanName(i.firstName);
  const subject = i.reminder ? SPOT_RELEASED_REMINDER_SUBJECT : SPOT_RELEASED_SUBJECT;
  const line = i.reminder ? SPOT_RELEASED_REMINDER_LINE : SPOT_RELEASED_LINE;
  const hi = first ? `Hi ${first},` : "Hi,";
  const steps = WHAT_HAPPENS_NEXT.steps.map((title) => ({ title }));
  const body = [
    K.greeting(hi),
    K.h1("Confirm your free Ready Check", 10, 8),
    K.p(line, "0 0 14px"),
    K.mistBox(WHAT_HAPPENS_NEXT.title, K.numberedSteps(steps, true), { marginTop: 4 }),
    K.button(i.confirmUrl, CONFIRM_BUTTON, "18px 0 4px"),
  ].join("\n");
  const html = K.emailShell({ body, previewText: line, testLabel: i.test === true, unsubscribe: i.unsubscribeUrl });
  const text = K.plainText([
    hi, "", line, "", WHAT_HAPPENS_NEXT.title, ...WHAT_HAPPENS_NEXT.steps.map((s, n) => `${n + 1}. ${s}`), "", `${CONFIRM_BUTTON}: ${i.confirmUrl}`,
  ], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
