// Pure rules for giving an approved trade worker their own sign-in. No I/O.

/** Jo must approve the invite email wording before any invite email is sent. Flip only on her go. */
export const TRADE_INVITE_EMAIL_APPROVED = false;

/** Draft wording for Jo's approval (shown in the office; the email itself uses the sign-in email template). */
export const TRADE_INVITE_DRAFT = {
  subject: "Set up your Home Insulation Victoria sign-in",
  body: "Hi {first_name}, {business} is approved to work with Home Insulation Victoria. Tap the button to set your password. After that, sign in at {sign_in_url} with this email to see your jobs.",
  button: "Set my password",
};

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
