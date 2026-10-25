// Decision 330: O72 "your electrical fixes are done — please confirm" (request and days-1/3 reminders use the same approved
// wording). PURE renderer on the email kit; kept apart from piesa-fixes-confirm.core.ts so client screens never bundle the kit.
import * as K from "./email-kit.core";
import { piesaFixesConfirmBody, piesaFixesConfirmSubject } from "./piesa-fixes-confirm.core";

export type PiesaFixesConfirmEmailInput = { firstName: string | null; fixesDate: string; electricianLine: string; confirmUrl: string; unsubscribeUrl: string | null; test?: boolean };
export function renderPiesaFixesConfirmEmail(i: PiesaFixesConfirmEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = piesaFixesConfirmSubject(first);
  const body = piesaFixesConfirmBody(i.electricianLine, i.fixesDate);
  const label = "Open my job page";
  const html = K.emailShell({ body: [K.h1(subject, 8), K.p(body, "0 0 14px", true), K.button(i.confirmUrl, label, "6px 0 4px")].join("\n"), previewText: null, testLabel: i.test === true, unsubscribe: i.unsubscribeUrl });
  const text = K.plainText([subject, "", body, "", `${label}: ${i.confirmUrl}`], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
