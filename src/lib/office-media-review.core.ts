import type { MediaReviewOutcome } from './enquiry-groups.core';
// Jo 23 Oct 08:51 UTC: photo review never sends. Rank buttons only move the Spots saved order;
// "Not eligible – close" needs a reason and closes the job. Jo 24 Oct (decision 5): closing also records the
// Office ineligible decision with the approved owner wording below and sends T7 (the guarded sender still applies).
export const PHOTO_INELIGIBLE_OWNER_REASON = "From the photos and details you sent us, the insulation already in your ceiling appears to be R2.0 or above. The VEU ceiling insulation rebate is only available where the existing insulation is below R2.0.";
export function mediaReviewPlan(outcome: MediaReviewOutcome, reason?: string, close = false) {
  if (close && outcome !== 'over_r2') throw new Error('Only "Not eligible" can close the enquiry.');
  if (close && !reason?.trim()) throw new Error('Give the reason for closing first.');
  return { outcome, reason: reason?.trim() || null, close, nextAction: close ? 'Closed — not eligible' : 'Rank only (Spots saved)', manualOnly: true, rankOnly: !close };
}