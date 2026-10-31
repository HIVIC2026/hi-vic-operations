import { qaOfficeIdentityBlocker, type QaOfficeIdentity } from "./qa-office.core";

export const TEST_OFFICE_UNAVAILABLE = "Not available for the TEST office login";
// Exact compiler-owned filename/name pairs. Unknown/new functions are never implicitly allowed.
export const QA_OFFICE_FUNCTIONS = {
  "src/lib/office-screens.functions.ts": ["getNeedsMePage", "getEnquiriesList", "getActiveJobsList", "getJobsLaneCounts", "getOfficeJobPage", "getOfficeJobMoney", "logOfficeCallOrNote"],
  "src/lib/office-money.functions.ts": ["getMoneyPayouts"],
  "src/lib/office.functions.ts": ["searchOffice", "approveElectricianForm", "markPayoutPaid"],
  "src/lib/ap-queue.functions.ts": ["getFinalCheck", "approveApJob"],
  "src/lib/spot-release.functions.ts": ["getSpotRelease", "releaseSpotFn"],
  "src/lib/offer-dispatch.functions.ts": ["listChooseTrades", "sendChosenOffers"],
  "src/lib/installer-waiting.functions.ts": ["getInstallerWaitingList"],
  "src/lib/coverage.functions.ts": ["getJobCoverage"],
  // Jo 28 Oct 22:23 UTC: installer quote card on TEST jobs only (server re-checks the job).
  "src/lib/installer-quote.functions.ts": ["getInstallerQuoteDraft", "sendInstallerQuote"],
  // Jo 30 Oct: cut-down Test Centre for automatic tests. Every action re-checks the job is an active TEST job.
  "src/lib/test-accounts.functions.ts": ["prepareQaJourneyAccess", "issueQaPersonaLink", "issueQaWorkerLink", "simulateQaJourneyTime", "simulateQaPayment", "archiveQaJourney"],
  "src/lib/portal.functions.ts": ["createTestEnquiry", "getQaJourneys"],
} as const;
export function qaOfficeFunctionAllowed(filename: string, name: string): boolean {
  const path = filename.replaceAll("\\", "/").replace(/^.*?(?=src\/)/, "");
  const names = QA_OFFICE_FUNCTIONS[path as keyof typeof QA_OFFICE_FUNCTIONS];
  return !!names && (names as readonly string[]).includes(name);
}
export function qaOfficeRouteAllowed(pathname: string, search = ""): boolean {
  const path = pathname.replace(/\/$/, "");
  if (["/admin", "/admin/needs-me", "/admin/enquiries", "/admin/jobs", "/admin/jobs/active", "/admin/jobs/ours", "/admin/jobs/installers", "/admin/jobs/choose-installer", "/admin/test-centre"].includes(path)) return true;
  if (path === "/admin/money") return new URLSearchParams(search).get("tab") === "payouts";
  return /^\/admin\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path);
}
/**
 * Speed gate for the global boundary, decided from signature-verified JWT claims only.
 * false = the caller provably signed in with a non-TEST email, so the boundary may skip its role read.
 * Anything else (no/odd email, anonymous, explicitly unconfirmed, anything resembling the TEST domain) = full check.
 * Deliberately broader than qaOfficeReservedEmail: a false "may be" only costs two trips.
 */
export function qaOfficeClaimsMayBeTestOffice(claims: unknown): boolean {
  if (!claims || typeof claims !== "object") return true;
  const c = claims as Record<string, unknown>;
  const email = typeof c["email"] === "string" ? c["email"].trim() : "";
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || /hivic-test/i.test(email)) return true;
  if (c["is_anonymous"] === true) return true;
  const meta = c["user_metadata"];
  if (meta !== undefined && (meta === null || typeof meta !== "object")) return true;
  const verified = (meta as Record<string, unknown> | undefined)?.["email_verified"];
  return verified !== undefined && verified !== true;
}
export function qaOfficeFunctionBlocker(identity: QaOfficeIdentity, filename: string, name: string): string | null {
  if (!identity.roles.includes("qa_office")) return null;
  return qaOfficeIdentityBlocker(identity) ?? (qaOfficeFunctionAllowed(filename, name) ? null : TEST_OFFICE_UNAVAILABLE);
}