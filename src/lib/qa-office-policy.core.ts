import { qaOfficeIdentityBlocker, type QaOfficeIdentity } from "./qa-office.core";

export const TEST_OFFICE_UNAVAILABLE = "Not available for the TEST office login";
// Exact compiler-owned filename/name pairs. Unknown/new functions are never implicitly allowed.
export const QA_OFFICE_FUNCTIONS = {
  "src/lib/office-screens.functions.ts": ["getNeedsMePage", "getEnquiriesList", "getActiveJobsList", "getOfficeJobPage", "getOfficeJobMoney", "logOfficeCallOrNote"],
  "src/lib/office-money.functions.ts": ["getMoneyPayouts"],
  "src/lib/office.functions.ts": ["approveElectricianForm", "markPayoutPaid"],
  "src/lib/ap-queue.functions.ts": ["getFinalCheck", "approveApJob"],
  "src/lib/spot-release.functions.ts": ["getSpotRelease", "releaseSpotFn"],
  "src/lib/offer-dispatch.functions.ts": ["listChooseTrades", "sendChosenOffers"],
  "src/lib/installer-waiting.functions.ts": ["getInstallerWaitingList"],
} as const;
export function qaOfficeFunctionAllowed(filename: string, name: string): boolean {
  const path = filename.replaceAll("\\", "/").replace(/^.*?(?=src\/)/, "");
  const names = QA_OFFICE_FUNCTIONS[path as keyof typeof QA_OFFICE_FUNCTIONS];
  return !!names && (names as readonly string[]).includes(name);
}
export function qaOfficeRouteAllowed(pathname: string, search = ""): boolean {
  const path = pathname.replace(/\/$/, "");
  if (["/admin", "/admin/needs-me", "/admin/enquiries", "/admin/jobs", "/admin/jobs/active", "/admin/jobs/choose-installer"].includes(path)) return true;
  if (path === "/admin/money") return new URLSearchParams(search).get("tab") === "payouts";
  return /^\/admin\/jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(path);
}
export function qaOfficeFunctionBlocker(identity: QaOfficeIdentity, filename: string, name: string): string | null {
  if (!identity.roles.includes("qa_office")) return null;
  return qaOfficeIdentityBlocker(identity) ?? (qaOfficeFunctionAllowed(filename, name) ? null : TEST_OFFICE_UNAVAILABLE);
}