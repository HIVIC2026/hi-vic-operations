// Decision 376 (Jo 25 Oct 2026, DRAFT — awaiting approval): the owner gets a copy of the Gate B paperwork they signed
// (the agreement, the payment statement, the VEEC assignment consent, landlord details…) — ONE email O75 "Your signed
// paperwork" per signing sitting, with each signed PDF from the job file attached (same email `attachments` path as the
// O63 consent copy). The 15-minute tick batches a sitting: it waits until the owner's last Gate B signature is
// PAPERWORK_COPY_QUIET_MINUTES old, then sends every not-yet-copied signature from the last PAPERWORK_COPY_LOOKBACK_DAYS
// together. Office-recorded items (landlord consent) are never copied. Replaces the F13 record-only point (the dead
// outbox row); nothing goes to a real owner until Jo approves (OWNER_PAPERWORK_COPY_APPROVED). PURE: rules, key, wording.
import * as K from "./email-kit.core";

/** DRAFT (decision 376): false until Jo approves O75. Real delivery also needs customer_comms_enabled + consent. */
export const OWNER_PAPERWORK_COPY_APPROVED = false as boolean;
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

export function renderPaperworkCopyEmail(i: PaperworkCopyEmailInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const address = i.address.trim();
  const lead = `Hi ${first}, thanks for signing. Here's a copy of what you signed for the ceiling insulation${address ? ` at ${address}` : ""}, for your records.`;
  const where = i.attached ? "The signed copies are attached as PDFs. They're also on your job page." : "The signed copies are on your job page.";
  const body = [
    K.h1(PAPERWORK_COPY_SUBJECT, 8),
    K.p(lead),
    K.mistBox("What you signed", K.checkList(i.titles.map(K.esc), 15, "6px")),
    K.p(where, "16px 0 0"),
    ...(i.myJobUrl ? [K.button(i.myJobUrl, "See my job")] : []),
    K.small("Questions? Just reply to this email."),
  ].join("\n");
  const html = K.emailShell({ body, previewText: lead, testLabel: i.test === true, unsubscribe: i.unsubscribeUrl });
  const text = K.plainText([PAPERWORK_COPY_SUBJECT, "", lead, "", "What you signed:", ...i.titles.map((t) => `- ${t}`), "", where, ...(i.myJobUrl ? [`See my job: ${i.myJobUrl}`] : []), "", "Questions? Just reply to this email."], { unsubscribe: i.unsubscribeUrl, testLabel: i.test === true });
  return { subject: PAPERWORK_COPY_SUBJECT, html, text };
}
