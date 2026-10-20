import { expect, test } from 'bun:test';
import { followupSendMessage, followupRequestError, uncertainAttempt } from '../src/lib/followup-result.core';
import { reviewedEstimateInsulation } from '../src/lib/reviewed-estimate.core';
import { morePhotosReviewBlocker } from '../src/lib/more-photos-request.core';

test('uncertain/unknown outcomes and send transport errors lock retries without claiming non-delivery', () => {
  for (const outcome of ['uncertain', 'unexpected']) {
    const message = followupSendMessage(outcome, 'provider unavailable');
    expect(message.lock).toBe(true); expect(message.text).not.toContain('Not sent');
    expect(message.text).toContain('history');
  }
  expect(followupRequestError('send').lock).toBe(true);
  expect(followupRequestError('send').text).toContain('may have been accepted');
  expect(followupRequestError('preview').lock).toBe(false);
  for (const status of ['sending', 'queued', 'delivered_unrecorded', 'sending_unknown']) expect(uncertainAttempt(status)).toBe(true);
  for (const outcome of ['blocked', 'failed', 'skipped']) expect(followupSendMessage(outcome, 'no provider call').lock).toBe(false);
});

const below = { id: 'review-1', outcome: 'below_r2', occurredAt: '2026-10-20T10:00:00Z' };
test('below-R2 plus original unknown needs explicit Office preparation, then retains the review provenance', () => {
  expect(reviewedEstimateInsulation('unknown', below, null)).toEqual({ insulation: 'unknown', review: null });
  expect(reviewedEstimateInsulation('unknown', below, null, 'below_r2')).toEqual({ insulation: 'present', review: below });
  expect(reviewedEstimateInsulation('unknown', below, below)).toEqual({ insulation: 'present', review: below });
  expect(below.outcome).toBe('below_r2'); // input objects are not rewritten
  expect(reviewedEstimateInsulation('unknown', { ...below, id: 'new-review', outcome: 'unclear' }, below)).toEqual({ insulation: 'unknown', review: null });
  expect(() => reviewedEstimateInsulation('unknown', { ...below, outcome: 'over_r2' }, below, 'below_r2')).toThrow();
  expect(reviewedEstimateInsulation('unknown', { ...below, outcome: 'no_insulation' }, null, 'no_insulation').insulation).toBe('none');
});

const review = { reviewId: 'review-1', expectedReviewId: 'review-1', reviewOutcome: 'unclear', reviewAt: '2026-10-20T10:00:00Z', latestMediaAt: '2026-10-20T09:00:00Z', openEnquiry: true };
test('extra-photo request requires the same current unclear review and no newer uploads', () => {
  expect(morePhotosReviewBlocker(review)).toBeNull();
  expect(morePhotosReviewBlocker({ ...review, latestMediaAt: '2026-10-20T10:01:00Z' })).toContain('New photos/video');
  expect(morePhotosReviewBlocker({ ...review, reviewId: 'replacement-review' })).toContain('changed');
  expect(morePhotosReviewBlocker({ ...review, reviewAt: 'unreadable' })).not.toBeNull();
  expect(morePhotosReviewBlocker({ ...review, reviewOutcome: 'below_r2' })).not.toBeNull();
  expect(morePhotosReviewBlocker({ ...review, openEnquiry: false })).not.toBeNull();
});


test('additional uploads require an actual current request and preserve original-media holds', async () => {
  const { requestedMorePhotosUploadAllowed } = await import('../src/lib/owner-capture-permission.core');
  const media = { excluded: true, received: true, uncertain: false, pendingSync: false, count: 2 };
  expect(requestedMorePhotosUploadAllowed(media, 'unclear', null)).toBe(false);
  expect(requestedMorePhotosUploadAllowed(media, 'unclear', '2026-10-20T10:01:00Z')).toBe(true);
  expect(requestedMorePhotosUploadAllowed({ ...media, uncertain: true }, 'unclear', '2026-10-20T10:01:00Z')).toBe(false);
  expect(requestedMorePhotosUploadAllowed({ ...media, pendingSync: true }, 'unclear', '2026-10-20T10:01:00Z')).toBe(false);
  expect(requestedMorePhotosUploadAllowed(media, 'below_r2', '2026-10-20T10:01:00Z')).toBe(false);
});
