// Part 3 Task 1 (Jo 2 Nov 2026): the electrician quotes, books and bills the electrical upgrades on EVERY job, so the
// in-house "partner bills rectification" exception is now the rule for every job (upgrades-billing.core). Every caller
// that read this to skip the HIV upgrades quote, its payment gate or its clearance step keeps the same answer: true.
// No database read: the held lookup and the business's `rectification_billed_by` column no longer decide anything.
import { electricianBillsUpgrades } from "./upgrades-billing.core";

/** Is the upgrades (rectification) work billed by the electrician/partner, not Home Insulation Victoria? Every job. */
export async function partnerBilledRectificationFor(jobId: string): Promise<boolean> {
  return electricianBillsUpgrades(jobId);
}

/** Optional sync/clearance extension: same answer, kept for its callers. */
export async function optionalPartnerBilledRectificationFor(jobId: string): Promise<boolean> {
  return electricianBillsUpgrades(jobId);
}
