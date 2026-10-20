export const MORE_PHOTOS_REQUEST_EVENT = 'office_more_photos_requested';
export const MORE_PHOTOS_REQUEST_PURPOSE = 'insulation_video_request';
export const morePhotosRequestReference = (reviewId: string) => `intake_media_review:${reviewId}`;
export const morePhotosRequestKey = (jobId: string, reviewId: string) => `office_more_photos:${jobId}:${reviewId}`;

/** Uploads since the review always return to Office; a later request cannot hide unreviewed media. */
export function morePhotosReviewBlocker(f: { reviewId: string | null; expectedReviewId?: string | undefined; reviewOutcome: string | null; reviewAt: string | null; latestMediaAt: string | null; openEnquiry: boolean }): string | null {
  if (!f.openEnquiry) return 'This enquiry is no longer awaiting a photo request.';
  if (!f.reviewId || f.reviewOutcome !== 'unclear' || (f.expectedReviewId && f.expectedReviewId !== f.reviewId)) return 'The Office photo review changed. Review the enquiry before requesting more photos/video.';
  const reviewedAt = Date.parse(f.reviewAt ?? '');
  if (!Number.isFinite(reviewedAt)) return 'The Office review date could not be verified.';
  if (f.latestMediaAt != null && (!Number.isFinite(Date.parse(f.latestMediaAt)) || Date.parse(f.latestMediaAt) > reviewedAt)) return 'New photos/video arrived after this review. Review the new uploads before asking for more.';
  return null;
}
