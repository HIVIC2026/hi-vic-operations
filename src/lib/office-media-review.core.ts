import type { MediaReviewOutcome } from './enquiry-groups.core';
export function mediaReviewPlan(outcome: MediaReviewOutcome, reason?: string) {
  if (outcome === 'over_r2' && !reason?.trim()) throw new Error('Confirm the ineligible reason first.');
  return { outcome, reason: reason?.trim() || null, nextAction: outcome === 'unclear' ? 'Request more photos' : outcome === 'over_r2' ? 'Send ineligible response' : 'Offer Save My Spot', manualOnly: true };
}