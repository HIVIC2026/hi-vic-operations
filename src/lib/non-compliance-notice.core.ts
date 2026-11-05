// Part 4 Task 13 (Jo 2 Nov 2026, answer 9; cl 27): when something on a job didn't comply (faulty product or work), the owner is
// told straight away. Jo decides and sends it the same day from an office button on the job page: no automatic trigger, no
// installer-side button. A compliance send (COMPLIANCE_OWNER_EMAIL_PURPOSES): Do not contact and Unsubscribe never block it.
// Pure wording + keys only. Wording APPROVED by Jo on the pack-1 picture (item 39, 4 Nov 2026); the flag stays false until go-live.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { AP_CERTIFICATES_LINE, contactLine } from "./owner-wording.core";
import { installerName, type Held, type TradeContact } from "./owner-will-call.core";

/** Wording approved (pack 1 item 39); flips to true at go-live. Off: nothing is sent to real owners (TEST jobs still test-send). */
export const NON_COMPLIANCE_NOTICE_APPROVED = false as boolean;
export const NON_COMPLIANCE_PURPOSE = "non_compliance_notice";
/** Recorded once per note, before the send. */
export const NON_COMPLIANCE_SENT_EVENT = "non_compliance_notice_sent";
/** Office note when the notice can't go yet (no office phone / business email on the installer). Nothing is sent. */
export const NON_COMPLIANCE_HELD_EVENT = "non_compliance_notice_held";

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
/** Small stable hash (FNV-1a) so the same note always gets the same key. */
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
/** One email per note per job, ever. The same what + fix pressed twice is the same note. */
export const nonComplianceKey = (jobId: string, what: string, fix: string) => `non-compliance:v1:${jobId}:${fnv(`${norm(what)}|${norm(fix)}`)}`;

/** Fix wave J1 (3): like `ownerWillCallEmail`, a contact with no office phone or business email is a `held` result — the
 *  builder never makes an email that says "call … on " with nothing after it; the server records the hold and sends nothing. */
export function nonComplianceHeldReason(c: TradeContact): Held | null {
  const who = installerName(c);
  if (!(c.officePhone ?? "").trim()) return { held: `No office phone for ${who}` };
  if (!(c.email ?? "").trim()) return { held: `No business email for ${who}` };
  return null;
}

export function nonComplianceNotice(i: { firstName: string | null; what: string; fix: string; contact: TradeContact; test?: boolean }): { subject: string; text: string; html: string } | Held {
  // Pack 1 item 39 (Jo 4 Nov 2026) — APPROVED redraft, text and html the same words. {Installer} = installerName(contact);
  // the phone is the installer's OFFICE number only (J1 (3): missing → `held`, like owner-will-call.core), never a mobile.
  const hold = nonComplianceHeldReason(i.contact);
  if (hold) return hold;
  const first = K.cleanName(i.firstName) ?? "there";
  const who = installerName(i.contact);
  const line = contactLine(i.contact);
  const phone = (i.contact.officePhone ?? "").trim();
  const subject = "About your ceiling insulation — one thing we need to put right";
  const greeting = `Hi ${first},`;
  const p1 = `We've checked your job and found one thing that doesn't meet the program's rules: ${norm(i.what)}.`;
  const p2 = `We'll fix it at no cost to you: ${norm(i.fix)}.`;
  const p3 = `${who} will call you to arrange a time.`;
  const p4 = "Nothing else changes — your rebate and your price stay as they are.";
  const p5 = `Questions? Reply to this email or call ${who} on ${phone}.`;
  const small = [line, AP_CERTIFICATES_LINE].filter((x): x is string => !!x);
  // Suite look (Jo 5 Nov 2026): greeting line, big heading (the approved subject), the approved paragraphs, "What happens
  // next" card (p3 + p4, same words), the question line, then the contact card. No new words.
  const heading = "One thing we need to put right";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${esc(greeting)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(heading)}</mj-text><mj-text>${esc(p1)}</mj-text><mj-text>${esc(p2)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 6px">What happens next</mj-text><mj-text padding="0 18px 4px">${esc(p3)}</mj-text><mj-text padding="0 18px 16px">${esc(p4)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="14px 12px 14px">${esc(p5)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="small" padding="14px 18px">${small.map(esc).join("<br/>")}</mj-text></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: p1, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([greeting, "", heading, "", p1, p2, "", "WHAT HAPPENS NEXT", p3, p4, "", p5, "", ...small], { testLabel: i.test === true });
  return { subject, text, html };
}
