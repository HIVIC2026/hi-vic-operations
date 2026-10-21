// Pure presentation of enquiry response facts. The facts themselves come from office_enquiry_index (0208).
// A recorded customer email is evidence a reply was RECORDED, never proof the provider delivered it.
export type ResponseState = 'provider_confirmed' | 'recorded_only' | 'uncertain' | 'none';
export type ResponseCounts = { provider_confirmed: number; recorded_only: number; uncertain: number; unanswered: number; unanswered_latest_failed: number };

export const RESPONSE_STATE_LABEL: Record<ResponseState, string> = {
  provider_confirmed: 'Reply sent · accepted by email service',
  recorded_only: 'Reply recorded · delivery not confirmed',
  uncertain: 'Reply outcome uncertain · not resent',
  none: 'No reply recorded',
};

/** Validates the RPC's response breakdown; anything missing/non-numeric is "unavailable", never zero. */
export function parseResponseCounts(x: unknown): ResponseCounts | null {
  if (!x || typeof x !== 'object') return null;
  const r = x as Record<string, unknown>;
  const keys: (keyof ResponseCounts)[] = ['provider_confirmed', 'recorded_only', 'uncertain', 'unanswered', 'unanswered_latest_failed'];
  const out = {} as ResponseCounts;
  for (const k of keys) { const n = Number(r[k]); if (r[k] == null || !Number.isInteger(n) || n < 0) return null; out[k] = n; }
  return out;
}

export type NextParty = 'office' | 'homeowner' | 'none';
/** Who owes the next step. Received-but-unreviewed media is always Office's turn, whatever the lane says. */
export function enquiryNextStep(f: { status: string; mediaToReview: boolean; reviewOutcome: string | null; morePhotosRequested?: boolean; mediaCount: number; fallback: string | null }): { party: NextParty; label: string } {
  if (f.mediaToReview) return { party: 'office', label: `Office: review ${f.mediaCount} photo${f.mediaCount === 1 ? '' : 's'}/video${f.reviewOutcome === 'unclear' ? ' (new upload after the last review)' : ''}` };
  if (f.status === 'spot_saved') return { party: 'office', label: 'Continue from Active jobs' };
  if (f.status === 'ineligible') return { party: 'none', label: 'No action unless the owner replies' };
  if (f.reviewOutcome === 'unclear') return f.morePhotosRequested === true ? { party: 'homeowner', label: 'Waiting for the owner to send more photos/video' } : { party: 'office', label: 'Office: request more photos/video' };
  if (f.status === 'offered_spot') return { party: 'homeowner', label: 'Waiting for the owner to save their spot' };
  if (f.reviewOutcome === 'below_r2') return { party: 'office', label: 'Office: send the existing-insulation Save your spot follow-up' };
  if (f.reviewOutcome === 'no_insulation') return { party: 'office', label: 'Office: send the no-insulation Save your spot offer' };
  if (f.status === 'insulation_requested') return { party: 'homeowner', label: 'Waiting for the owner’s photos/video' };
  return { party: 'office', label: f.fallback ?? 'Office: decide the next step' };
}

/** "Showing 51–100 of 1,277" — never "N shown" for a bounded page. */
export function showingRange(page: number, pageSize: number, rowsOnPage: number, total: number): string {
  if (!total || !rowsOnPage) return `Showing 0 of ${total.toLocaleString('en-AU')}`;
  const start = (page - 1) * pageSize + 1;
  return `Showing ${start.toLocaleString('en-AU')}–${(start + rowsOnPage - 1).toLocaleString('en-AU')} of ${total.toLocaleString('en-AU')}`;
}

/** Office no-insulation Save your spot offer: the photo review alone never decides eligibility. */
export function noInsulationOfferBlocker(f: { source: string | null; stage: string | null; outcome: string | null; decisionSource: string | null; reviewRequired: boolean; latestReview: string | null }): string | null {
  if (f.source !== 'base44') return 'Only website owner enquiries can be offered here.';
  if (!['new_enquiry', 'eligibility_review', 'preliminary_estimate_ready'].includes(f.stage ?? '')) return 'This enquiry is no longer awaiting an offer.';
  if (f.latestReview !== 'no_insulation') return 'The latest Office photo review is not “no insulation”.';
  if (f.outcome !== 'likely_eligible' || f.reviewRequired || !['admin', 'system'].includes(f.decisionSource ?? '')) return 'Record the Office eligibility decision (likely eligible) first — photos alone never decide eligibility.';
  return null;
}
