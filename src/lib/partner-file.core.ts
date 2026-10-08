/** Caller must verify business membership before using this rule. */
export function partnerFileBucket(businessId: string, path: string, credentialRecorded: boolean): "job-files" | "partner-files" | null {
  if (!path || path.split("/").some((p) => p === "." || p === "..") || path.includes("\\")) return null;
  if (path.startsWith(`partners/${businessId}/`)) return "job-files";
  if (credentialRecorded && /^(installer-onboarding|rec-onboarding)\/[0-9a-f-]{36}\/.+$/i.test(path)) return "partner-files";
  return null;
}