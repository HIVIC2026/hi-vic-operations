// Missing-size estimate guard. Pure; tested in tests/no-size-estimate.test.ts.
import { DEFAULT_ESTIMATED_AREA_M2 } from "./estimate.core";

/** A typical-area estimate may only go as the owner's own automatic first reply, priced on exactly the
 *  labelled typical area, for a home with no insulation and no owner-entered size. Null = allowed. */
export function noSizeEstimateBlocker(x: { areaSource: string | null; areaM2: number | null; ownerArea: number | null; insulation: string | null; followup: boolean; automaticInitial: boolean }): string | null {
  if (x.areaSource !== "typical_default") return null;
  if (x.followup || x.insulation !== "none") return "Typical-size estimates are only for homes with no existing insulation.";
  if (x.ownerArea && x.ownerArea > 0) return "Owner has entered a ceiling size; the estimate must be recalculated first.";
  if (x.areaM2 !== DEFAULT_ESTIMATED_AREA_M2) return "Estimate area does not match the typical-size assumption.";
  if (!x.automaticInitial) return "Missing-size estimates go only as the automatic first reply to a new enquiry, never from a list.";
  return null;
}

/** Real typical-150 m² first replies are HELD: no durable, once-only "original initial enquiry" claim exists yet,
 *  and the website enquiry contract does not currently send a missing size. Age windows were never approved and
 *  cannot tell a new enquiry from a re-run backlog job, so nothing real qualifies until that claim is built. */
export const NO_SIZE_REAL_SEND_HELD = "Typical-size first reply is on hold until the original enquiry can be proven new; nothing sent.";
export function initialReplyQualifies(_x: { originalInitialClaim: null }): boolean { return false; }
