// Pure: the shared frame for every portal email (Jo, 26 Oct 2026 — the MJML email refresh). Each renderer writes its
// body as MJML sections and calls `mjEmail`, which adds the shared head, logo header and footer and compiles the result
// with `mjml-lite.core.ts`. The designs live as MJML sources in docs/templates/mjml/ (open them with real MJML to edit
// or preview). Presentation only: wording stays in each renderer.
import { renderMjml } from "./mjml-lite.core";
import { UNSUBSCRIBE_LINK_SLOT } from "./emailsafety.core";
import { esc } from "./email-kit.core";

export { esc };
/** Hosted logo (Gmail and Outlook block embedded `data:` images). Same file as CUSTOMER_BRAND.logoUrl. */
export const MAIL_LOGO_URL = "https://homeinsulationvictoria.com.au/home-insulation-victoria-logo.png";
export const MAIL_HEADER = `<mj-section><mj-column><mj-image src="${MAIL_LOGO_URL}" alt="Home Insulation Victoria" width="132px" align="left" padding="0 12px 2px" /></mj-column></mj-section>`;
const TEST_PILL = `<mj-section><mj-column><mj-text padding="8px 12px 0"><span style="display:inline-block;background:#FDF2F6;color:#22376B;font-size:11px;font-weight:700;padding:3px 8px;border-radius:999px;">TEST — only sent to Jo</span></mj-text></mj-column></mj-section>`;
const UNSUB_TOKEN = "__HIV_UNSUBSCRIBE__";

/** The footer: AP number, company and ABN; plus the Unsubscribe link for owner emails that carry one. */
export function mailFooter(unsubscribe: string | "slot" | null | undefined): string {
  const link = unsubscribe === "slot" ? `<br />${UNSUB_TOKEN}` : unsubscribe ? `<br /><a href="${esc(unsubscribe)}" style="color:#5A6785;">Unsubscribe</a>` : "";
  return `<mj-section><mj-column><mj-divider padding="14px 12px 14px" /><mj-text mj-class="small" font-size="12px" line-height="18px" padding="0 12px">Home Insulation Victoria · VEU Accredited Person A003654<br />DC Construction Solutions Pty Ltd · ABN 44 671 613 979${link}</mj-text></mj-column></mj-section>`;
}

export type MailInput = {
  /** Subject line (also the <title>), plain text. */
  subject: string;
  /** Inbox preview line, plain text. */
  preview?: string | null;
  /** The email's own `<mj-section>`s (MJML), between the logo and the footer. */
  body: string;
  /** Unsubscribe link: a URL, the secure slot (`withUnsubscribe` fills it), or null for no link. */
  unsubscribe?: string | "slot" | null;
  /** "TEST — only sent to Jo" pill under the logo. */
  testLabel?: boolean;
};

/** Builds and compiles one email. */
export function mjEmail(i: MailInput): string {
  const src = `<mjml lang="en-AU"><mj-head><mj-title>${esc(i.subject)}</mj-title>${i.preview ? `<mj-preview>${esc(i.preview)}</mj-preview>` : ""}<mj-include path="./partials/head.mjml" /></mj-head><mj-body><mj-wrapper css-class="card">${MAIL_HEADER}${i.testLabel ? TEST_PILL : ""}${i.body}${mailFooter(i.unsubscribe)}</mj-wrapper></mj-body></mjml>`;
  return renderMjml(src).replace(UNSUB_TOKEN, UNSUBSCRIBE_LINK_SLOT);
}

/* Small helpers for the repeated rows (all return MJML-ready HTML for inside <mj-table>). */
export const tickRow = (title: string, detail?: string | null, last = false) =>
  `<tr><td width="32" valign="top" style="padding:2px 0 ${last ? 12 : 14}px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 ${last ? 12 : 14}px;"><strong>${title}</strong>${detail ? `<br /><span class="muted">${detail}</span>` : ""}</td></tr>`;
export const plusRow = (html: string) =>
  `<tr><td width="32" valign="top" style="padding:2px 0 12px;"><span class="plus">+</span></td><td style="padding:0 0 12px;">${html}</td></tr>`;
export const numRow = (n: number, html: string) =>
  `<tr><td width="34" valign="top" style="padding:1px 0 12px;"><span class="num">${n}</span></td><td style="padding:0 0 12px;">${html}</td></tr>`;
