// Pure rules + emails for office "Send back for changes" / "Decline" (Jo, 7 Oct 2026 5:45pm).
// Both wordings APPROVED by Jo 8 Oct 2026 7:44am: real sends go to the partner's real address. Since 24 Oct 2026
// (decision 137) they render in the approved kit shell; since 26 Oct 2026 in the MJML designs (docs/templates/mjml/
// installer_changes, installer_decline, installer_I53). "We've got your application" (decision 136) is approved too (APPLICATION_RECEIVED_EMAIL_APPROVED); no automatic sender yet.
import { partnerEmailLayout } from "./partner-email.core";
import * as K from "./email-kit.core";
import { mjEmail, esc } from "./mail-mjml.core";

export const APPLICATION_REVIEW_WORDING_APPROVED = true as const;
/** Jo 24 Oct 2026, decision 136 (I53 "We've got your application"): approved. */
export const APPLICATION_RECEIVED_EMAIL_APPROVED = true as boolean;

/** Decision 136: "Thanks {First}," / "We've got your application" — what we check, approval + Mitti invite, start adding jobs. */
export function renderApplicationReceivedEmail(i: { contactName?: string | null; businessName: string; test?: boolean }) {
  const name = K.cleanName(i.contactName);
  const subject = "We've got your application";
  const hi = `Thanks${name ? ` ${name}` : ""},`;
  const headline = "We've got your application";
  const intro = `${i.businessName}'s application to install under the VEU program with Home Insulation Victoria is in.`;
  const preview = "Here's what happens next, and how long it usually takes.";
  const steps: K.Step[] = [
    { title: "We check your details", detail: "CII certification and public liability insurance (min $5 million). Usually within 2 business days." },
    { title: "You're approved", detail: "You get an email to set your password, plus an invite to Mitti, the app you'll fill forms in." },
    { title: "Start adding jobs", detail: "Add your own customers in about 30 seconds, and take the jobs we send you." },
  ];
  const missing = "If anything's missing, we'll email you exactly what we need.";
  const step = (s: K.Step, n: number) => { const pad = n === steps.length - 1 ? 12 : 14; return `<tr><td width="32" valign="top" style="padding:2px 0 ${pad}px;"><span class="num">${n + 1}</span></td><td style="padding:0 0 ${pad}px;"><strong>${esc(s.title)}</strong><br /><span class="muted">${esc(s.detail)}</span></td></tr>`; };
  const body = [
    `<mj-section><mj-column><mj-text mj-class="hi">${esc(hi)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(headline)}</mj-text><mj-text>${esc(intro)}</mj-text></mj-column></mj-section>`,
    `<mj-section><mj-column mj-class="panel-card"><mj-text mj-class="h2" padding="18px 18px 10px">What happens next</mj-text><mj-table padding="0 18px 6px">${steps.map(step).join("")}</mj-table></mj-column></mj-section>`,
    `<mj-section><mj-column><mj-text padding="14px 12px 14px">${esc(missing)}</mj-text><mj-text mj-class="small">Questions? Just reply to this email.</mj-text></mj-column></mj-section>`,
  ].join("");
  const html = mjEmail({ subject, preview, body, unsubscribe: null, testLabel: i.test === true });
  const text = K.plainText([hi, "", headline, "", intro, "", "WHAT HAPPENS NEXT", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "", missing, "", "Questions? Just reply to this email."], { testLabel: i.test === true });
  return { subject, html, text };
}
export type ReviewDecision = "changes_requested" | "declined";

const clean = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").slice(0, 2000);
const first = (n: string | null | undefined) => clean(n).split(" ")[0] || null;
/** Joins the office text into a sentence without doubling the full stop. */
const sentence = (s: string) => (/[.!?]$/.test(s) ? s : `${s}.`);

export function reviewInputError(decision: ReviewDecision, message: string | null | undefined): string | null {
  const m = clean(message);
  if (decision === "changes_requested" && m.length < 3) return "Type a short message telling the installer what to check.";
  if (m.length > 2000) return "Keep the message under 2,000 characters.";
  return null;
}

export function changesEmail(i: { contactName?: string | null; message: string; link: string; test?: boolean }) {
  const name = first(i.contactName);
  const subject = "Your Home Insulation Victoria application – a quick change needed";
  const { html, text } = partnerEmailLayout({ subject, heading: "A quick change needed", preview: "One thing to check, then update your application and sign again.", blocks: [
    { kind: "hi", text: `Hi ${name ?? "there"}, thanks for applying.` },
    { kind: "p", text: "Before we can approve your application, please check this:" },
    { kind: "box", text: clean(i.message) },
    { kind: "p", text: "Then use the button below to update your application and sign again." },
    { kind: "button", label: "Update my application", url: i.link },
  ], test: i.test !== false });
  return { subject, html, text };
}

export function declineEmail(i: { contactName?: string | null; reason?: string | null; test?: boolean }) {
  const name = first(i.contactName);
  const reason = clean(i.reason);
  const subject = "Your Home Insulation Victoria application";
  const lines = [
    "Thank you for applying to work with Home Insulation Victoria.",
    `Unfortunately we're unable to approve your application at this time.${reason ? ` ${sentence(reason)}` : ""}`,
    "If your circumstances change, you're welcome to apply again.",
  ];
  const { html, text } = partnerEmailLayout({ subject, heading: "Your application", preview: "An update on your application to work with Home Insulation Victoria.", blocks: [{ kind: "hi", text: `Hi ${name ?? "there"},` }, ...lines.map((t) => ({ kind: "p" as const, text: t })), { kind: "sign", lines: ["Kind regards,", "Jo", "Home Insulation Victoria"] }], test: i.test !== false });
  return { subject, html, text };
}

/** What the installer's link shows for a signed application (presentation only). */
export function applicantReviewState(review: { decision: ReviewDecision } | null): "with_office" | "changes_requested" | "declined" {
  return review ? review.decision : "with_office";
}
