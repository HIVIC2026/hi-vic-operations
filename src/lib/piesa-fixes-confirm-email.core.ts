// Decision 330: O72 "your electrical fixes are done — please confirm" (request and days-1/3 reminders use the same approved
// wording). PURE renderer on the email kit; kept apart from piesa-fixes-confirm.core.ts so client screens never bundle the kit.
import * as K from "./email-kit.core";
import { esc, mjEmail } from "./mail-mjml.core";
import { piesaFixesConfirmBody, piesaFixesConfirmSubject } from "./piesa-fixes-confirm.core";

export type PiesaFixesConfirmEmailInput = { firstName: string | null; fixesDate: string; electricianLine: string; confirmUrl: string; unsubscribeUrl: string | null; test?: boolean };
export function renderPiesaFixesConfirmEmail(i: PiesaFixesConfirmEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const subject = piesaFixesConfirmSubject(first);
  const body = piesaFixesConfirmBody(i.electricianLine, i.fixesDate);
  const label = "Open my job page";
  // Design: docs/templates/mjml/owner_fixes-confirm.mjml (MJML email refresh, Jo 27 Oct 2026) — the date in bold.
  const dateAt = body.lastIndexOf(i.fixesDate);
  const bodyHtml = dateAt >= 0 ? `${esc(body.slice(0, dateAt))}<strong>${esc(i.fixesDate)}</strong>${esc(body.slice(dateAt + i.fixesDate.length))}` : esc(body);
  const preview = `${i.electricianLine} finished on ${i.fixesDate}. Confirming on your job page takes a minute.`;
  const mj = `<mj-section><mj-column><mj-text mj-class="h1" css-class="email-heading">${esc(subject)}</mj-text><mj-text>${bodyHtml}</mj-text><mj-button href="${esc(i.confirmUrl)}" padding="6px 12px 0">${esc(label)}</mj-button></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview, body: mj, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([subject, "", body, "", `${label}: ${i.confirmUrl}`], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
