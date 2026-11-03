// Speed (portal speed step 1, Task 6): reads the installer job page's sections all need, taken ONCE for one verified caller
// and one job and handed to each section. Server-side only; nothing here is sent to the browser. A section uses a value only
// when it was taken for the same user and job it is serving, and every section keeps its own access check — this saves the
// repeat database reads, never a check.
import type { InstallerQuote } from "./installer-quote-status.server";
import type { Clearance } from "./allocation.core";
import type { TradeJobAccess } from "./trade-view.server";

export type SharedJobReads = {
  readonly userId: string;
  readonly jobId: string;
  /** The trade context that already passed `requireTradeJob` for this user and job. */
  readonly access: TradeJobAccess;
  /** The latest Ready Check installation quote and its status (`loadInstallerQuote`), read once. */
  readonly quote: () => Promise<InstallerQuote>;
  /** The electrical clearance (`electricalClearance(await clearanceFacts(jobId))`), read once. */
  readonly clearance: () => Promise<Clearance>;
};

/** `shared` when it was taken for exactly this user and job, otherwise undefined (the section reads for itself). */
export function sharedFor(shared: SharedJobReads | undefined, userId: string, jobId: string): SharedJobReads | undefined {
  return shared && shared.userId === userId && shared.jobId === jobId && shared.access.checkedFor.userId === userId && shared.access.checkedFor.jobId === jobId ? shared : undefined;
}

/** Reads start on first use and are shared after that, including a failure (each section handles it as it did its own). */
export function sharedJobReads(access: TradeJobAccess, userId: string, jobId: string, read: { quote: (jobId: string) => Promise<InstallerQuote>; clearance: (jobId: string) => Promise<Clearance> }): SharedJobReads {
  let quote: Promise<InstallerQuote> | undefined;
  let clearance: Promise<Clearance> | undefined;
  return {
    userId, jobId, access,
    quote: () => (quote ??= read.quote(jobId)),
    clearance: () => (clearance ??= read.clearance(jobId)),
  };
}
