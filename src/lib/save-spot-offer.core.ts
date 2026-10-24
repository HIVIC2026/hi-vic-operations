// Save My Spot – variant choice + personal-calculator choice (Jo, 12 Oct 2026). PURE: no I/O.
// The old three-variant "Save your spot" email this module used to render (Office "Prepare email to copy") was
// removed on 24 Oct 2026: owner first emails now come only from the approved O1/O2 designs (jo-outcome-email.core).
// Variant 3 (existing insulation reviewed, appears under R2) is chosen ONLY from an authoritative recorded media review.
import { DEFAULT_ESTIMATED_AREA_M2 } from "./estimate.core";

export type SaveSpotVariant = "no_insulation_owner_size" | "no_insulation_assumed_size" | "reviewed_under_r2";
/** Picks the approved variant from recorded facts. Never infers "no insulation" and never treats uploaded media as reviewed. */
export function pickSaveSpotVariant(x: {
  route: "offer_spot" | "request_insulation" | "ineligible" | "none";
  insulation: string | null; mediaReview: string | null; criteriaPassed: boolean; areaAssumed: boolean;
}): { variant: SaveSpotVariant; assumedArea: boolean } | { blocked: string } {
  if (x.route === "offer_spot") {
    if (x.insulation !== "none") return { blocked: "The estimate does not record 'no existing insulation' – no approved Save my spot email applies." };
    return { variant: x.areaAssumed ? "no_insulation_assumed_size" : "no_insulation_owner_size", assumedArea: x.areaAssumed };
  }
  if (x.route === "request_insulation") {
    if (x.mediaReview !== "below_r2" || !x.criteriaPassed)
      return { blocked: "Existing insulation has not been reviewed as under R2 by the office. Review the photos/video first – no Save my spot email until then." };
    if (x.insulation !== "present") return { blocked: "The current estimate does not record the existing insulation. Recalculate it before preparing an email." };
    return { variant: "reviewed_under_r2", assumedArea: x.areaAssumed };
  }
  return { blocked: "No approved Save my spot email applies to this lead." };
}

// ---------- Owner's choice on the personal calculator ----------
export type SpotChoice = "original" | "updated";
/** The original offered estimate is usable only when it is the current stored estimate and (if assumed) still the
 *  configured assumption with the owner's size unknown. Reviewed-under-R2 homes may use the assumption too. */
export function originalEstimateBlocker(x: { estimate: { area_m2: number | string | null; area_source: string | null; insulation_declared: string | null; hasPrice: boolean } | null; ownerAreaKnown: boolean; reviewedUnderR2: boolean }): string | null {
  const e = x.estimate;
  if (!e || !e.hasPrice) return "We couldn’t find the original estimate from your email. Please use the calculator or contact us and we’ll help.";
  if (e.area_source !== "typical_default") return null;
  if (x.ownerAreaKnown) return "Your ceiling size has changed since the original estimate. Please use the calculator to save your spot with your size.";
  if (Number(e.area_m2) !== DEFAULT_ESTIMATED_AREA_M2) return "We couldn’t confirm the original estimate. Please contact us and we’ll help.";
  if (e.insulation_declared === "none") return null;
  if (e.insulation_declared === "present" && x.reviewedUnderR2) return null;
  return "We couldn’t confirm the original estimate. Please contact us and we’ll help.";
}
/** The calculator never changes recorded insulation facts: the server uses the original estimate's insulation. */
export function calculatorInsulation(originalInsulation: string | null): "none" | "present" | "unknown" {
  return originalInsulation === "none" || originalInsulation === "present" ? originalInsulation : "unknown";
}
export const SPOT_SAVED_HEADING = "Your spot has been saved";
export const SPOT_SAVED_BODY = "You’re now in our queue for a free Ready Check. We’ll contact you when installer availability is confirmed in your area. There’s nothing to pay now, and you’re under no obligation to proceed. Your eligibility, ceiling area and final price will be confirmed before you decide to go ahead.";
