import type { MediaReviewOutcome } from './enquiry-groups.core';
export function mediaReviewPlan(outcome: MediaReviewOutcome, reason?: string) {
  if (outcome === 'over_r2' && (!reason || reason.trim().length < 3)) throw new Error('Confirm the ineligible reason first.');
  return { outcome, reason: reason?.trim() || null, nextAction: outcome === 'unclear' ? 'Request more photos / video' : outcome === 'over_r2' ? 'Ineligible review' : 'Ready to offer Save My Spot', manualOnly: true };
}