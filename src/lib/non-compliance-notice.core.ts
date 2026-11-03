// Part 4 Task 13 (Jo 2 Nov 2026, answer 9; cl 27): when something on a job didn't comply (faulty product or work), the owner is
// told straight away. Jo decides and sends it the same day from an office button on the job page: no automatic trigger, no
// installer-side button. A compliance send (COMPLIANCE_OWNER_EMAIL_PURPOSES): Do not contact and Unsubscribe never block it.
// Pure wording + keys only. The wording is a DRAFT for Jo (shown to her as a picture before the flag turns on).
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";
import { AP_CERTIFICATES_LINE, contactLine } from "./owner-wording.core";
import { installerName, type TradeContact } from "./owner-will-call.core";

/** Flip to true only when Jo approves the wording on the picture. Off: nothing is sent to real owners (TEST jobs still test-send). */
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

export function nonComplianceNotice(i: { firstName: string | null; what: string; fix: string; contact: TradeContact }): { subject: string; text: string; html: string } {
  const first = K.cleanName(i.firstName) ?? "there";
  const who = installerName(i.contact);
  const line = contactLine(i.contact);
  const subject = "Something on your job didn't meet the rules"; // draft for Jo
  const greeting = `Hi ${first},`; // draft for Jo
  const p1 = `We found something that didn't meet the rules: ${norm(i.what)}.`; // draft for Jo
  const p2 = `Any fix will meet the rules: ${norm(i.fix)}.`; // draft for Jo
  const p3 = `${who} will contact you.`; // draft for Jo
  const small = [line, AP_CERTIFICATES_LINE].filter((x): x is string => !!x);
  const body = [
    `<mj-section><mj-column><mj-text>${esc(greeting)}</mj-text><mj-text>${esc(p1)}</mj-text><mj-text>${esc(p2)}</mj-text><mj-text>${esc(p3)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="small" padding="14px 18px">${small.map(esc).join("<br/>")}</mj-text></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: p1, body, unsubscribe: null, testLabel: false });
  const text = K.plainText([greeting, "", p1, p2, p3, "", ...small]);
  return { subject, text, html };
}
