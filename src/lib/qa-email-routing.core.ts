import { TEST_ALLOWLIST, normaliseEmail } from "./test-send.core";

export const QA_EMAIL_INBOX = "jolowexo@hotmail.com";
export function qaEmailRoute(source: string | null, original: string, html: string, text: string) {
  if (source !== "qa_test") return { to: original, html, text, redirected: false };
  if (!(TEST_ALLOWLIST.email as readonly string[]).includes(QA_EMAIL_INBOX)) throw new Error("Jo's TEST email address is not allowlisted; nothing sent.");
  const marker = `TEST — would have gone to: ${normaliseEmail(original)}`;
  const escaped = marker.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
  const banner = `<div role="note"><strong>${escaped}</strong></div>`;
  return { to: QA_EMAIL_INBOX, html: /<body\b[^>]*>/i.test(html) ? html.replace(/<body\b[^>]*>/i, tag => `${tag}${banner}`) : `${banner}${html}`, text: `${marker}\n\n${text}`, redirected: true };
}

export function qaEmailGuard(master: boolean, approved: boolean | undefined): string | null {
  if (!master) return "customer_comms_enabled is OFF — TEST email held";
  if (approved !== true) return "Per-email approval is OFF or not verified — TEST email held";
  return null;
}