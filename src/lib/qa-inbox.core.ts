// Jo 27 Oct 08:58: emails for qa_test jobs are delivered to Jo's own allowlisted inbox, marked with who they would have
// gone to. Pure: no I/O. Real jobs: null route = unchanged recipient and content. SMS is never routed here.
import { TEST_ALLOWLIST, normaliseEmail } from "./test-send.core";

export const QA_INBOX = "jolowexo@hotmail.com";
if (!(TEST_ALLOWLIST.email as readonly string[]).includes(QA_INBOX)) throw new Error("TEST inbox must be on the TEST email allowlist.");

const RESERVED = /@(?:[a-z0-9-]+\.)*hivic-test\.example$/i;

/** TEST-domain identities are shown in full; anything else is masked so no real detail appears in a TEST email. */
export function maskRecipient(to: string): string {
  const e = normaliseEmail(to);
  if (RESERVED.test(e) || (TEST_ALLOWLIST.email as readonly string[]).includes(e)) return e;
  const [user = "", domain = ""] = e.split("@");
  return `${user.slice(0, 1)}***@${domain.replace(/^[^.]*/, (d) => d.slice(0, 1) + "***")}`;
}

export type QaInboxRoute = { to: string; original: string; marker: string };

/** Only a persisted qa_test job source routes; everything else returns null (unchanged). */
export function qaInboxRoute(persistedSource: string | null | undefined, to: string): QaInboxRoute | null {
  if (persistedSource !== "qa_test") return null;
  const original = maskRecipient(to);
  return { to: QA_INBOX, original, marker: `TEST — would have gone to: ${original}` };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Marker at the very top of the email body and a TEST subject prefix. */
export function markTestEmail(route: QaInboxRoute, mail: { subject: string; html: string; text: string }) {
  const banner = `<div style="background:#FFF4CC;border:2px solid #B45309;color:#7C2D12;padding:12px 16px;font:600 15px Arial,sans-serif">${esc(route.marker)}</div>`;
  const html = /<body[^>]*>/i.test(mail.html) ? mail.html.replace(/<body[^>]*>/i, (b) => b + banner) : banner + mail.html;
  return { subject: mail.subject.startsWith("[TEST") ? mail.subject : `[TEST] ${mail.subject}`, html, text: `${route.marker}\n\n${mail.text}` };
}
