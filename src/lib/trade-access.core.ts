// Pure rules for giving an approved trade worker their own sign-in. No I/O.
import { mjEmail, esc } from "./mail-mjml.core";
import { plainText } from "./email-kit.core";

/** Jo must approve the invite email wording before any invite email is sent. Flip only on her go. */
export const TRADE_INVITE_EMAIL_APPROVED = false;

/** Draft wording for Jo's approval (shown in the office; the email itself uses the sign-in email template).
 *  Design: docs/templates/mjml/waiting_trade-invite.mjml (greeting once, short heading, sign-in line under the button). */
const INVITE_INTRO = "{business} is approved to work with Home Insulation Victoria. Tap the button to set your password.";
const INVITE_AFTER = "After that, sign in at {sign_in_url} with this email to see your jobs.";
export const TRADE_INVITE_DRAFT = {
  subject: "Set up your Home Insulation Victoria sign-in",
  preview: "Set your password, then sign in to see your jobs.",
  greeting: "Hi {first_name},",
  heading: "Set up your sign-in",
  /** The whole message without the greeting (office display); the email puts `after` under the button. */
  body: `${INVITE_INTRO} ${INVITE_AFTER}`,
  intro: INVITE_INTRO,
  button: "Set my password",
  after: INVITE_AFTER,
};

const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);

/** The invite as an email (Templates page preview of the approved design). No unsubscribe: trade email. */
export function renderTradeInviteEmail(i: { firstName: string | null; business: string; setPasswordUrl: string; signInUrl: string; test?: boolean }) {
  const D = TRADE_INVITE_DRAFT;
  const v = { first_name: i.firstName?.trim() || "there", business: i.business, sign_in_url: i.signInUrl };
  const greeting = fill(D.greeting, v);
  const body = fill(D.intro, v);
  const [before, after] = D.after.split("{sign_in_url}");
  const signIn = `<a href="${esc(i.signInUrl)}" style="color:#3C51C4;font-weight:700;">${esc(i.signInUrl.replace(/^https?:\/\//, ""))}</a>`;
  const mj = `<mj-section><mj-column><mj-text mj-class="hi">${esc(greeting)}</mj-text><mj-text mj-class="h1" css-class="email-heading" padding="4px 12px 10px">${esc(D.heading)}</mj-text><mj-text>${esc(body)}</mj-text><mj-button href="${esc(i.setPasswordUrl)}">${esc(D.button)}</mj-button><mj-text mj-class="small" padding="0 12px 6px">${esc(before)}${signIn}${esc(after)}</mj-text></mj-column></mj-section>`;
  const html = mjEmail({ subject: D.subject, preview: D.preview, body: mj, unsubscribe: null, testLabel: i.test === true });
  const text = plainText([greeting, "", D.heading, body, "", `${D.button}: ${i.setPasswordUrl}`, "", fill(D.after, v)], { testLabel: i.test === true });
  return { subject: D.subject, html, text };
}

export type WorkerForAccess = { email: string; approval_status: string; removed_at: string | null; trade_role: string; certification_status: string | null };

/** Why this worker can't get a sign-in yet, or null. */
export function tradeAccessBlocker(w: WorkerForAccess, businessApproved: boolean): string | null {
  if (!businessApproved) return "The business isn't approved yet.";
  if (w.removed_at) return "This person has been removed from the business.";
  if (w.approval_status !== "approved") return "Approve this person first.";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(w.email.trim())) return "This person needs a valid email.";
  if (w.trade_role === "installer" && w.certification_status !== "verified") return "Verify this installer's EEC certification first.";
  return null;
}

/** Business admin if their email matches the business email; otherwise a member. */
export function memberRoleFor(workerEmail: string, businessEmail: string | null): "business_admin" | "member" {
  return !!businessEmail && workerEmail.trim().toLowerCase() === businessEmail.trim().toLowerCase() ? "business_admin" : "member";
}

/** Only these trade roles are ever granted by an invite. */
export function grantedRole(tradeRole: string): "installer" | "electrician" {
  return tradeRole === "electrician" ? "electrician" : "installer";
}
