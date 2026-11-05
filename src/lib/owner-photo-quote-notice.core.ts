// Photo-quote installers (spec decision 3, Jo 5 Nov 2026): when the job goes to a "From photos" installer the owner gets
// ONE email, "Good news: no visit needed", instead of #23 "{Installer} will call you". No text message. PURE.
// Same holds as will-call (owner-will-call.core): no office phone or no business email → `{ held }`.
// DRAFT wording: real owners get nothing until Jo approves it (OWNER_PHOTO_QUOTE_NOTICE_APPROVED).
import * as K from "./email-kit.core";
import { mjEmail } from "./mail-mjml.core";
import { AP_CERTIFICATES_LINE, contactLine } from "./owner-wording.core";
import { installerName, type Held, type OwnerWillCallInput } from "./owner-will-call.core";

export const OWNER_PHOTO_QUOTE_NOTICE_APPROVED: boolean = false;
export const OWNER_PHOTO_QUOTE_NOTICE_PURPOSE = "owner_photo_quote_notice";
export const OWNER_PHOTO_QUOTE_NOTICE_HELD_EVENT = "owner_photo_quote_notice_held";
export const OWNER_PHOTO_QUOTE_NOTICE_SUBJECT = "Good news: no visit needed";
/** Once per job per give. */
export const ownerPhotoQuoteNoticeKey = (jobId: string, batchId: string) => `owner-photo-quote-notice:v1:${jobId}:${batchId}`;

const clean = (v: string | null | undefined) => (v ?? "").trim();

export function ownerPhotoQuoteEmail(i: OwnerWillCallInput): { subject: string; html: string; text: string } | Held {
  const name = installerName(i.installer);
  if (!clean(i.installer.officePhone)) return { held: `No office phone for ${name}` };
  if (!clean(i.installer.email)) return { held: `No business email for ${name}` };
  const contact = contactLine(i.installer)!;
  const first = K.cleanName(i.firstName);
  const hi = `Hi${first ? ` ${first}` : ""},`;
  const subject = OWNER_PHOTO_QUOTE_NOTICE_SUBJECT;
  const p1 = `Good news: ${name} can quote from the photos you sent, so you don't need a Ready Check visit.`;
  const p2 = "Your quote is on its way.";
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${K.esc(hi)}</mj-text><mj-text>${K.esc(p1)}</mj-text><mj-text>${K.esc(p2)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="small" padding="14px 18px">${K.esc(contact)}<br/>${K.esc(AP_CERTIFICATES_LINE)}</mj-text></mj-column></mj-section>`,
  ].join("\n");
  const html = mjEmail({ subject, preview: p1, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([hi, p1, p2, "", contact, AP_CERTIFICATES_LINE], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject, html, text };
}
