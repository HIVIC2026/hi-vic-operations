// Evidence-only policy. Never turn an unexecuted step or an unproven safety boundary into PASS.
export const SCREEN_PEOPLE = ["homeowner", "office", "installer owner", "installer staff", "electrician"] as const;
export const SCREEN_STEPS = ["Website enquiry", "Save my spot", "Office release", "Installer acceptance", "Ready Check booking", "Ready Check completion", "Office quote release", "Owner acceptance", "PIESA payment and booking", "PIESA completed form approval", "Install deposit and days", "Install day and evidence", "AP final check", "Final payout"] as const;
export type ScreenStatus = "pass" | "fail" | "blocked";
export type ScreenRow = { step: string; person: string; status: ScreenStatus; detail: string; severity: "Stop launch" | "Fix soon" | "Polish" | null; screenshot: string | null; database: unknown; emailRows: number | null };
export function reservedPerson(email: string) { return /^[^@\s]+@(?:[a-z0-9-]+\.)*hivic-test\.example$/i.test(email); }
export function screenMutationBlocker(f: { websiteSandbox: boolean; serverSendingKeysRemoved: boolean; serverMittiGuard: boolean; demoOnly: boolean; ownQaJob: boolean }): string | null {
  if (!f.websiteSandbox) return "No isolated Base44 website enquiry page is configured for this run.";
  if (!f.serverSendingKeysRemoved || !f.serverMittiGuard) return "The browser's running portal process has no verified no-send/simulated-Mitti boundary; a guard in the command process does not guard browser server requests.";
  if (!f.demoOnly) return "Demo Company (AU) is not independently verified for every server-side Xero request.";
  if (!f.ownQaJob) return "No fresh qa_test job owned by this run has been created through a safe website page.";
  return null;
}
export function screenTotals(rows: ScreenRow[]) { return { pass: rows.filter(r => r.status === "pass").length, fail: rows.filter(r => r.status === "fail").length, blocked: rows.filter(r => r.status === "blocked").length }; }