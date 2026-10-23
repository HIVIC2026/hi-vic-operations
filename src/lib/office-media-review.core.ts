import type { MediaReviewOutcome } from './enquiry-groups.core';
// Jo 23 Oct 08:51 UTC: photo review never sends. Rank buttons only move the Spots saved order;
// "Not eligible – close" needs a reason and closes the job (email only if the office ticks it, sent separately).
export function mediaReviewPlan(outcome: MediaReviewOutcome, reason?: string, close = false) {
  if (close && outcome !== 'over_r2') throw new Error('Only "Not eligible" can close the enquiry.');
  if (close && !reason?.trim()) throw new Error('Give the reason for closing first.');
  return { outcome, reason: reason?.trim() || null, close, nextAction: close ? 'Closed — not eligible' : 'Rank only (Spots saved)', manualOnly: true, rankOnly: !close };
}