// Jo 30 Oct: TEST journeys made by the TEST office login must use a TEST owner email, so a real person can never
// be put on a test job. Pure, no I/O.
export const QA_TEST_EMAIL_RULE = "TEST journeys from the TEST office must use a @hivic-test.example owner email.";

export const QA_TEST_EMAIL_IN_USE = "That email is already a portal account. Use a new @hivic-test.example email for each TEST journey.";

export function isQaTestEmail(email: string | null | undefined): boolean {
  return /^[^@\s]+@hivic-test\.example$/.test((email ?? "").trim().toLowerCase());
}

/** Who may create a TEST journey: admin (any email, as now) or the TEST office alone (TEST email only). */
export function testEnquiryBlocker(roles: { admin: boolean; qaOffice: boolean }, ownerEmail: string | null | undefined, opts: { emailHasAccount?: boolean } = {}): string | null {
  if (roles.admin === roles.qaOffice) return "Admin only.";
  if (roles.qaOffice && !isQaTestEmail(ownerEmail)) return QA_TEST_EMAIL_RULE;
  // Review 30 Oct: never let a TEST office journey attach the owner role to an existing account (incl. its own).
  if (roles.qaOffice && opts.emailHasAccount) return QA_TEST_EMAIL_IN_USE;
  return null;
}
