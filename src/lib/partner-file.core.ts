/** Caller must verify business membership before using this rule. */
export function partnerFileBucket(businessId: string, path: string, credentialRecorded: boolean): "job-files" | "partner-files" | null {
  if (!path || path.split("/").some((p) => p === "." || p === "..") || path.includes("\\")) return null;
  if (path.startsWith(`partners/${businessId}/`)) return "job-files";
  if (credentialRecorded && /^(installer-onboarding|rec-onboarding)\/[0-9a-f-]{36}\/.+$/i.test(path)) return "partner-files";
  // Part 2b: an installer uploads its electrician's licence / PL / WorkCover under ITS OWN prefix, but the credential row
  // belongs to the ELECTRICIAN business. `credentialRecorded` means the caller found a business_credentials row for
  // exactly this business + path, so the file is that electrician's paperwork and opens from job-files.
  if (credentialRecorded && /^partners\/[0-9a-f-]{36}\/electrician-uploads\/.+$/i.test(path)) return "job-files";
  return null;
}
