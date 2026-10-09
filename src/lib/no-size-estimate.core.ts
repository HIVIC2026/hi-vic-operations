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
