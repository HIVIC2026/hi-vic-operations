// Jo's own one-off office emails to partner applicants and approved partners (7 Oct).
// Pure rules. Automated messages and anything to homeowners stay behind the TEST switches/allowlist.
import { TEST_ALLOWLIST, normaliseEmail } from "./test-send.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { plainText } from "./email-kit.core";

export const OFFICE_REPLY_TO = "info@homeinsulationvictoria.com.au";
export type OfficeEmailOrigin = "office_manual" | "automated";
export type OfficeRecipient = "applicant" | "partner" | "homeowner";

/** null = this email may go to the real address. Fails closed. */
export function officeEmailBlocker(x: { origin: OfficeEmailOrigin; recipient: OfficeRecipient; to: string | null | undefined; message: string | null | undefined }): string | null {
  if (x.origin !== "office_manual") return "Automated emails stay behind the sending switches.";
  if (x.recipient === "homeowner") return "Owner emails stay behind the sending switches.";
  const to = normaliseEmail(x.to);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return "There's no valid email address on this record.";
  if (!(x.message ?? "").trim()) return "Type a message first.";
  return null;
}

/** Automated test-run applications never reach a typed address: they go to Jo's test inbox. */
export const officeEmailTo = (to: string, testMode: boolean) => (testMode ? TEST_ALLOWLIST.email[0] : normaliseEmail(to));

export function officeEmailCopy(x: { contactName: string | null; subject: string; message: string }) {
  const first = x.contactName?.trim().split(/\s+/)[0];
  const lines = x.message.trim().split(/\n{2,}/).map((p) => p.replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
  return { subject: x.subject.trim() || "A message from Home Insulation Victoria", heading: first ? `Hi ${first},` : "Hello,", lines: [...lines, "Just reply to this email if you have any questions."] };
}

/** The office's typed message in the MJML design (docs/templates/mjml/office_typed-message.mjml, Jo 26 Oct 2026): greeting,
 *  the subject as the heading, the typed paragraphs, the reply line. What sendOfficeEmail sends when no html is passed. */
export function officeEmailLayout(x: { contactName: string | null; subject: string; message: string; test?: boolean }) {
  const c = officeEmailCopy(x);
  const reply = c.lines[c.lines.length - 1]!;
  const paras = c.lines.slice(0, -1);
  const body = `<mj-section><mj-column><mj-text mj-class="hi">${esc(c.heading)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(c.subject)}</mj-text>${paras.map((p) => `<mj-text>${esc(p)}</mj-text>`).join("")}<mj-text mj-class="small">${esc(reply)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject: c.subject, preview: "A message from the Home Insulation Victoria office.", body, unsubscribe: null, testLabel: x.test === true });
  const text = plainText([c.heading, "", c.subject, "", ...paras.flatMap((p) => [p, ""]), reply], { testLabel: x.test === true });
  return { subject: c.subject, html, text };
}

/** The installer's invite to a new electrician in the MJML design (docs/templates/mjml/electrician_invite.mjml, Jo 26 Oct 2026):
 *  the application link as a button. Subject from `electricianInviteEmail` (job-electrician.core), which stays the logged message. */
export function electricianInviteLayout(x: { electricianName: string; installerName: string; link: string; test?: boolean }) {
  const subject = `${x.installerName} has invited you to Home Insulation Victoria`;
  const first = x.electricianName?.trim().split(/\s+/)[0];
  const hi = first ? `Hi ${first},` : "Hello,";
  const headline = `${x.installerName} has invited you`;
  const lines = [`${x.installerName} would like you to do the PIESAs on their Home Insulation Victoria jobs.`, "To get started, fill in the electrician application. Once you're approved, their jobs come straight to you."];
  const reply = "Just reply to this email if you have any questions.";
  const body = `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(headline)}</mj-text>${lines.map((l) => `<mj-text>${esc(l)}</mj-text>`).join("")}<mj-button href="${esc(x.link)}">Fill in the application</mj-button><mj-text mj-class="small">${esc(reply)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject, preview: "Fill in the electrician application. Once you're approved, their jobs come straight to you.", body, unsubscribe: null, testLabel: x.test === true });
  const text = plainText([hi, "", headline, "", lines[0], "", lines[1], "", `Fill in the application: ${x.link}`, "", reply], { testLabel: x.test === true });
  return { subject, html, text };
}
