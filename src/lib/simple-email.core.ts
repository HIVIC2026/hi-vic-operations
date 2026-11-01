// Compatibility API for TEST messages; presentation uses only the approved suite generic layout.
import { genericMail } from './mail-mjml.core';
/** Simple branded email: navy heading, body lines, one green button. */
export type SimpleEmailExtras = {
  /** Trusted escaped markup assembled by a pure renderer, never raw owner input. */
  bodyHtml?: string; afterButtonHtml?: string; footerHtml?: string;
  textLines?: string[]; previewText?: string; testLabel?: boolean;
};
export function simpleEmail(heading: string, lines: string[], button?: { label: string; url: string }, extras: SimpleEmailExtras = {}) {
  const html = genericMail({ subject: heading, heading, lines, button, bodyHtml: extras.bodyHtml, afterButtonHtml: extras.afterButtonHtml, footerHtml: extras.footerHtml, preview: extras.previewText, testLabel: extras.testLabel !== false });
  const text = [heading, "", ...(extras.textLines ?? lines), ...(button ? ["", `${button.label}: ${button.url}`] : []), ...(extras.testLabel === false ? [] : ["", "TEST — only sent to Jo."])].join("\n");
  return { html, text };
}
