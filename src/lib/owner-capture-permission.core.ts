import type { GroupBMediaState } from './group-b-media.core';

/** A specific request allows a batch of additional files until Office records a new review.
 * The first file returns the work to Office but must not interrupt the homeowner's remaining uploads. */
export function requestedMorePhotosUploadAllowed(media: GroupBMediaState, reviewOutcome: string | null, requestAt: string | null): boolean {
  return !media.uncertain && !media.pendingSync && reviewOutcome === 'unclear' && requestAt != null && Number.isFinite(Date.parse(requestAt));
}
