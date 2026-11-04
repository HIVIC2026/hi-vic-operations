// Part 3 Task 1 (Jo 2 Nov 2026): "electrical upgrades on every job are quoted, booked and invoiced by the installer /
// electrician directly with the owner". Home Insulation Victoria never builds, sends or invoices an upgrades
// (rectification) quote and adds no markup — on HIV leads, installers' own jobs and in-house partners alike. HIV only
// needs the Part C and the Certificate of Electrical Safety before the install (Task 4).
//
// This is the ONE place that rule lives. It generalises the older in-house "partner bills rectification" mode
// (in-house.core `partnerBillsRectification`, which now delegates here) to every job, so every existing
// `partnerBilledRectification` read keeps working and a future reversal is one line in `electricianBillsUpgrades`.
// No I/O.

/** Does the electrician (not Home Insulation Victoria) quote, book and bill the electrical upgrades on this job?
 *  Always true since 2 Nov 2026. The optional job argument is accepted so call sites can pass what they have today
 *  and a later per-job rule needs no signature change. */
export function electricianBillsUpgrades(_job?: unknown): true {
  return true;
}

/** Reason recorded when a quote step is skipped because the electrician bills the upgrades. */
export const ELECTRICIAN_BILLS_SKIP = "electrician_bills" as const;

/** Owner-facing line for the My job electrical upgrades screen when Home Insulation Victoria holds no upgrades quote. */
export const UPGRADES_BILLED_BY_ELECTRICIAN =
  "Your electrician quotes and arranges the electrical upgrades with you directly.";

/** Office-facing reason the Send button on an upgrades (rectification) quote is blocked. */
export const UPGRADES_QUOTE_SEND_BLOCKER = "Electricians bill upgrades directly.";
