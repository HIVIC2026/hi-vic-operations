// Pure rules + DRAFT emails for office "Send back for changes" / "Decline" (Jo, 7 Oct 2026 5:45pm).
// Both email wordings are DRAFT: real (non-TEST) sends stay blocked until Jo approves them.
import { partnerEmailLayout } from "./partner-email.core";

export const APPLICATION_REVIEW_WORDING_APPROVED = false as const;
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
