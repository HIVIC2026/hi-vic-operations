// Pure rules + emails for office "Send back for changes" / "Decline" (Jo, 7 Oct 2026 5:45pm).
// Both wordings APPROVED by Jo 8 Oct 2026 7:44am: real sends go to the partner's real address. Since 24 Oct 2026
// (decision 137) they render in the approved kit shell. "We've got your application" (decision 136,
// docs/templates/approved/I53-application-received.html) is approved too (APPLICATION_RECEIVED_EMAIL_APPROVED); no automatic sender yet.
import { partnerEmailLayout } from "./partner-email.core";
import * as K from "./email-kit.core";

export const APPLICATION_REVIEW_WORDING_APPROVED = true as const;
/** Jo 24 Oct 2026, decision 136 (I53 "We've got your application"): approved. */
export const APPLICATION_RECEIVED_EMAIL_APPROVED = true as boolean;

/** Decision 136: "Thanks {First}, we've got your application" — what we check, approval + Mitti invite, start adding jobs. */
export function renderApplicationReceivedEmail(i: { contactName?: string | null; businessName: string; test?: boolean }) {
  const name = K.cleanName(i.contactName);
  const subject = "We've got your application";
  const headline = `Thanks${name ? ` ${name}` : ""}, we've got your application`;
  const intro = `${i.businessName}'s application to install under the VEU program with Home Insulation Victoria is in. Here's what happens next.`;
  const steps: K.Step[] = [
    { title: "We check your details", detail: "CII certification, public liability insurance (min $5 million) and PIISA training. Usually within 2 business days." },
    { title: "You're approved", detail: "You get an email to set your password, plus an invite to Mitti, the app you'll fill forms in." },
    { title: "Start adding jobs", detail: "Add your own customers in about 30 seconds, and take the jobs we send you." },
  ];
  const missing = "If anything's missing from your application we'll email you exactly what we need.";
  const body = [K.h1(headline, 8), K.p(intro), K.numberedSteps(steps), K.note(missing, "6px 0 0"), K.small("Questions? Just reply to this email.")].join("\n");
  const html = K.emailShell({ body, previewText: intro, testLabel: i.test === true, unsubscribe: null });
  const text = K.plainText([headline, "", intro, "", ...steps.map((s, n) => `${n + 1}. ${s.title}: ${s.detail}`), "", missing, "", "Questions? Just reply to this email."], { testLabel: i.test === true });
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
  const lines = [
    `Hi ${name ?? "there"}, thanks for applying to work with Home Insulation Victoria.`,
    `Before we can approve your application, we need you to check the following: ${sentence(clean(i.message))}`,
    "Please use the button below to update your application and sign again.",
  ];
  const { html, text } = partnerEmailLayout({ subject, heading: "A quick change needed", blocks: [...lines.map((t) => ({ kind: "p" as const, text: t })), { kind: "button", label: "Update my application", url: i.link }], test: i.test !== false });
  return { subject, html, text };
}

export function declineEmail(i: { contactName?: string | null; reason?: string | null; test?: boolean }) {
  const name = first(i.contactName);
  const reason = clean(i.reason);
  const subject = "Your Home Insulation Victoria application";
  const lines = [
    `Hi ${name ?? "there"}, thank you for applying to work with Home Insulation Victoria.`,
    `Unfortunately we're unable to approve your application at this time.${reason ? ` ${sentence(reason)}` : ""}`,
    "If your circumstances change, you're welcome to apply again.",
  ];
  const { html, text } = partnerEmailLayout({ subject, heading: "Your application", blocks: [...lines.map((t) => ({ kind: "p" as const, text: t })), { kind: "sign", lines: ["Kind regards,", "Jo", "Home Insulation Victoria"] }], test: i.test !== false });
  return { subject, html, text };
}

/** What the installer's link shows for a signed application (presentation only). */
export function applicantReviewState(review: { decision: ReviewDecision } | null): "with_office" | "changes_requested" | "declined" {
  return review ? review.decision : "with_office";
}
