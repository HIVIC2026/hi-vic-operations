// qa_office is never a global administrator. Each capability must carry its complete TEST scope.
export type QaOfficeIdentity = { roles: readonly string[]; email: string | null; emailVerified: boolean };
export type QaOfficeBusiness = { id: string; email: string | null; onboarding_notes: string | null };
export type QaOfficeJob = {
  source: string | null; deletedAt: string | null; archivedAt: string | null;
  ownerEmail: string | null; peopleEmails: readonly (string | null)[];
  businesses: readonly QaOfficeBusiness[];
};
export const qaOfficeReservedEmail = (email: string | null) => /^[^@\s]+@hivic-test\.example$/i.test(email?.trim() ?? "");
export function qaOfficeIdentityBlocker(identity: QaOfficeIdentity): string | null {
  if (identity.roles.length !== 1 || identity.roles[0] !== "qa_office") return "A dedicated qa_office role is required; mixed roles are refused.";
  if (!identity.emailVerified || !qaOfficeReservedEmail(identity.email)) return "A verified TEST-domain office identity is required.";
  return null;
}
export function qaOfficeJobBlocker(identity: QaOfficeIdentity, job: QaOfficeJob | null): string | null {
  const blocked = qaOfficeIdentityBlocker(identity);
  if (blocked) return blocked;
  if (!job || job.source !== "qa_test" || job.deletedAt || job.archivedAt) return "Only active qa_test jobs are available to TEST office.";
  if (!qaOfficeReservedEmail(job.ownerEmail) || job.peopleEmails.some(email => !qaOfficeReservedEmail(email))) return "The job contains a non-TEST or missing person identity.";
  if (job.businesses.some(business => !business.onboarding_notes?.includes("[TEST PARTNER]") || !qaOfficeReservedEmail(business.email))) return "The job contains a non-TEST or missing business identity.";
  return null;
}
export const QA_OFFICE_GLOBAL_DENIAL = "TEST office cannot access global administration, settings, switches, wording approvals, users or roles.";
export function qaOfficeGlobalBlocker(): string { return QA_OFFICE_GLOBAL_DENIAL; }