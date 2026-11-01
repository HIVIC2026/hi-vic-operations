// Decision 376 (Jo 25 Oct 2026; wording APPROVED by Jo in decision 384): the owner gets a copy of the Gate B paperwork they signed
// (the agreement, the payment statement, the VEEC assignment consent, landlord details…) — ONE email O75 "Your signed
// paperwork" per signing sitting, with each signed PDF from the job file attached (same email `attachments` path as the
// O63 consent copy). The 15-minute tick batches a sitting: it waits until the owner's last Gate B signature is
// PAPERWORK_COPY_QUIET_MINUTES old, then sends every not-yet-copied signature from the last PAPERWORK_COPY_LOOKBACK_DAYS
// together. Office-recorded items (landlord consent) are never copied. Replaces the F13 record-only point (the dead
// outbox row). Approved (decision 384): real owners go through the guarded owner email path behind customer_comms_enabled.
// Design: docs/templates/mjml/owner_O75.mjml. PURE: rules, key, wording.
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";

/** Jo 25 Oct 2026 (decision 384): O75 approved as drafted in decision 376. Real delivery also needs customer_comms_enabled + consent. */
export const OWNER_PAPERWORK_COPY_APPROVED = true as boolean;
export const OWNER_PAPERWORK_COPY_TEMPLATE_CODE = "O75";
export const OWNER_PAPERWORK_COPY_PURPOSE = "owner_paperwork_copy";
/** Recorded ONCE per batch BEFORE anything is sent (details: { signature_ids, doc_keys }). */
export const OWNER_PAPERWORK_COPY_EVENT = "owner_paperwork_copy";
/** Wait this long after the owner's latest Gate B signature, so one sitting is one email. */
export const PAPERWORK_COPY_QUIET_MINUTES = 10;
/** Only signatures this recent are copied (no backlog release when the sender goes live). */
export const PAPERWORK_COPY_LOOKBACK_DAYS = 2;

export type PaperworkSignature = { id: string; gate: string; method: string; signed_at: string; doc_key: string; title: string; copy_path: string | null };

/** One key per batch: the job + the batch's first signature (a later sitting has new signatures, so a new key). */
export const paperworkCopyKey = (jobId: string, signatureIds: string[]) => `owner-paperwork-copy:v1:${jobId}:${[...signatureIds].sort()[0] ?? "none"}`;

/** The signatures to copy now, or [] while the owner is still signing / nothing is new. */
export function paperworkCopyBatch(i: { signatures: PaperworkSignature[]; copiedIds: ReadonlySet<string>; now: Date }): PaperworkSignature[] {
  const since = i.now.getTime() - PAPERWORK_COPY_LOOKBACK_DAYS * 86_400_000;
  const mine = i.signatures.filter((s) => s.gate === "B" && s.method !== "office" && Date.parse(s.signed_at) >= since);
  const pending = mine.filter((s) => !i.copiedIds.has(s.id));
  if (!pending.length) return [];
  const latest = Math.max(...mine.map((s) => Date.parse(s.signed_at)));
  if (i.now.getTime() - latest < PAPERWORK_COPY_QUIET_MINUTES * 60_000) return [];
  return [...pending].sort((a, b) => a.signed_at.localeCompare(b.signed_at));
}

/** Attachment filename the owner sees: "Signed - The agreement - HV-3117.pdf". */
export const paperworkCopyFilename = (title: string, jobNumber: string | null) =>
  `Signed - ${title.replace(/[^A-Za-z0-9 ()-]+/g, " ").replace(/\s+/g, " ").trim()}${jobNumber ? ` - ${jobNumber.replace(/[^A-Za-z0-9-]+/g, "")}` : ""}.pdf`;

export type PaperworkCopyEmailInput = { firstName: string | null; address: string; titles: string[]; attached: boolean; myJobUrl: string | null; unsubscribeUrl: string | null; test?: boolean };

export const PAPERWORK_COPY_SUBJECT = "Your signed paperwork";

/** Owner-facing name of a signed item: no "VEEC" jargon for owners (design fix, docs/templates/mjml/notes/owner_O75.json).
 *  Presentation only — the stored title and the attachment filename are unchanged. */
export const paperworkCopyTitle = (title: string) => (/^Your rebate \(VEEC assignment\)$/i.test(title.trim()) ? "Your rebate form" : title);

export function renderPaperworkCopyEmail(i: PaperworkCopyEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const address = i.address.trim();
  const hi = `Hi ${first}, thanks for signing.`;
  const lead = `Here's a copy of what you signed for the ceiling insulation${address ? ` at ${address}` : ""}, for your records.`;
  const where = i.attached ? "The signed copies are attached as PDFs." : "Just reply to this email if you'd like PDF copies.";
  const preview = i.attached ? "Thanks for signing. Your copies are attached as PDFs for your records." : "Thanks for signing. Just reply if you'd like PDF copies.";
  const titles = i.titles.map(paperworkCopyTitle);
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(PAPERWORK_COPY_SUBJECT)}</mj-text><mj-text>${esc(lead)}</mj-text></mj-column></mj-section>`,
    titles.length ? `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What you signed</mj-text><mj-table padding="0 18px 6px">${titles.map((t) => `<tr><td width="32" valign="top" style="padding:2px 0 12px;"><span class="tick">&#10003;</span></td><td style="padding:0 0 12px;">${esc(t)}</td></tr>`).join("")}</mj-table></mj-column></mj-section>` : "",
    `<mj-section><mj-column><mj-text padding="16px 12px 14px">${esc(where)}</mj-text><mj-text mj-class="small" padding="0 12px">Questions? Just reply to this email.</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject: PAPERWORK_COPY_SUBJECT, preview, body, unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  const text = K.plainText([hi, "", PAPERWORK_COPY_SUBJECT, "", lead, "", "What you signed:", ...titles.map((t) => `- ${t}`), "", where,  "", "Questions? Just reply to this email."], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject: PAPERWORK_COPY_SUBJECT, html, text };
}
