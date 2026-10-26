// Jo 24 Oct 2026 (decisions 123 and 170): the ESC recommends giving the property owner a copy of the executed consent
// form, so once the AP representative has signed Part B the owner is emailed "Your signed consent form" in the approved
// kit design (docs/templates/owner/O63-consent-copy.html). Wording approved by Jo (decision 170); delivery still goes
// only through the guarded owner-email path (customer_comms_enabled, consent, opt-outs) and TEST jobs use test-send.
// The executed PDF from the job file is attached when it can be read (same Resend `attachments` path as the O62 VEEC
// copy); the form text also travels in the body and the owner is pointed to the copy on their job page. Pure.
import * as K from "./email-kit.core";

/** Jo 24 Oct 2026 (decision 170): wording approved. */
export const CONSENT_COPY_EMAIL_APPROVED = true as boolean;

export type ConsentCopyInput = {
  firstName: string | null; installationDays: string[]; address: string; templateVersion: string;
  /** The executed form, rendered by consent.core renderConsentBody (one line per form line). */
  formText: string; sha256: string; myJobUrl: string | null; test?: boolean;
  /** True when the executed PDF is attached to this email. */
  attached?: boolean;
};

export const CONSENT_COPY_SUBJECT = "Your signed consent form";
/** Attachment filename the owner sees. */
export const consentCopyFilename = (jobNumber: string | null) => `Owner-consent-form-${(jobNumber || "signed").replace(/[^A-Za-z0-9-]+/g, "-")}.pdf`;

export function renderConsentCopyEmail(i: ConsentCopyInput) {
  const first = K.cleanName(i.firstName) ?? "there";
  const headline = CONSENT_COPY_SUBJECT;
  const address = i.address.trim();
  const body = `Hi ${first}, here's your copy of the owner's consent form you signed for the ceiling insulation at ${address}. It's also on your job page.`;
  const formLines = i.formText.split("\n").map((l) => l.trimEnd());
  const formHtml = `<div style="font-size:12px;line-height:1.5;color:${K.KIT.NAVY};white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;">${formLines.map(K.esc).join("<br>")}</div>`;
  const meta = `${i.templateVersion ? `Form ${i.templateVersion} · ` : ""}Record reference ${i.sha256.slice(0, 12)}`;
  const html = K.emailShell({
    body: [
      K.h1(headline),
      K.p(body),
      ...(i.myJobUrl ? [K.button(i.myJobUrl, "See my job")] : []),
      ...(i.attached ? [K.small("The signed form is attached as a PDF.", "10px 0 0", { center: true, size: 14 })] : []),
      K.sectionTitle("Your signed form", "24px 0 8px"),
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${K.KIT.LINE};border-radius:14px;background:${K.KIT.WHITE};"><tr><td style="padding:14px 16px;">${formHtml}</td></tr></table>`,
      K.small(meta, "8px 0 0"),
      K.small("Questions? Just reply to this email."),
    ].join("\n"),
    previewText: body, testLabel: i.test === true, unsubscribe: null,
  });
  const text = K.plainText([
    headline, "", body, ...(i.myJobUrl ? [`See my job: ${i.myJobUrl}`] : []), ...(i.attached ? ["The signed form is attached as a PDF."] : []), "",
    "YOUR SIGNED FORM", ...formLines, "", meta, "", "Questions? Just reply to this email.",
  ], { testLabel: i.test === true });
  return { subject: CONSENT_COPY_SUBJECT, html, text };
}
