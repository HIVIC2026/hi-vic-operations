import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { groupBMediaForJob } from './group-b-media.server';
import { groupBInitialAction } from './group-b-media.core';
import { morePhotosReviewBlocker } from './more-photos-request.core';
import { CAPTURE_MAX_FILES, CAPTURE_SOURCE_SYSTEM } from './owner-capture.core';

/** Both send boundaries use these fresh Office-review and media facts. No request is recorded by reading them. */
export async function morePhotosRequestReview(jobId: string, expectedReviewId?: string): Promise<{ reviewId: string | null; blocker: string | null }> {
  const [reviews, index, media, uploads] = await Promise.all([
    admin.from('customer_engagement_events').select('id,metadata,occurred_at').eq('job_id', jobId).eq('event_type', 'intake_media_reviewed').eq('source', 'office').order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(1),
    admin.from('office_enquiry_index').select('office_bucket,source,latest_media_at').eq('id', jobId).maybeSingle(),
    groupBMediaForJob(jobId),
    admin.from('documents').select('id', { count: 'exact', head: true }).eq('job_id', jobId).eq('source_system', CAPTURE_SOURCE_SYSTEM),
  ]);
  const review = reviews.data?.[0];
  if (reviews.error || index.error || uploads.error || uploads.count == null || !index.data) return { reviewId: null, blocker: 'Could not verify the latest Office review and uploads.' };
  if (uploads.count >= CAPTURE_MAX_FILES) return { reviewId: review?.id ?? null, blocker: 'This owner has reached the upload limit. Arrange the next evidence check with the owner before requesting more files.' };
  const safeMedia = groupBInitialAction(media);
  if ('held' in safeMedia) return { reviewId: review?.id ?? null, blocker: 'Original uploads are still importing or could not be verified. Check the uploads before requesting more.' };
  const blocker = morePhotosReviewBlocker({ reviewId: review?.id ?? null, expectedReviewId, reviewOutcome: (review?.metadata as { outcome?: string } | null)?.outcome ?? null, reviewAt: review?.occurred_at ?? null, latestMediaAt: index.data.latest_media_at, openEnquiry: index.data.office_bucket === 'enquiry' && index.data.source === 'base44' });
  return { reviewId: review?.id ?? null, blocker };
}
