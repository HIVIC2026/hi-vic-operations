import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { refreshIndicativeEstimate } from './estimate.server';
import { syncStep3 } from './estimatelink.server';
import { linkUsable } from './estimatelink.core';
import { noInsulationOfferBlocker } from './enquiry-response.core';
import { sendExistingInsulationSaveSpot, sendSaveMySpot, type HotSendResult } from './hot-leads-send.server';
import type { OfferReviewOutcome } from './reviewed-estimate.core';

export type ReviewedOfferResult = HotSendResult & { needsEstimate?: boolean };
/** Explicit Office action. Review facts can prepare prices; they never write an eligibility decision. */
export async function reviewedInsulationOffer(jobId: string, actorId: string | null, review: OfferReviewOutcome, mode: 'preview' | 'prepare' | 'send'): Promise<ReviewedOfferResult> {
  const [job, reviews, estimate, existingLink] = await Promise.all([
    admin.from('jobs').select('job_number,source,stage,eligibility_outcome,eligibility_decision_source,eligibility_review_required').eq('id', jobId).maybeSingle(),
    admin.from('customer_engagement_events').select('id,metadata').eq('job_id', jobId).eq('event_type', 'intake_media_reviewed').eq('source', 'office').order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(1),
    admin.from('indicative_estimates').select('insulation_declared').eq('job_id', jobId).eq('status', 'current').maybeSingle(),
    admin.from('customer_estimate_links').select('id,status,expires_at').eq('job_id', jobId).eq('purpose', 'step3_estimate').eq('status', 'active').maybeSingle(),
  ]);
  const result = (outcome: HotSendResult['outcome'], detail: string, needsEstimate = false): ReviewedOfferResult => ({ jobId, jobNumber: job.data?.job_number ?? null, outcome, detail, needsEstimate });
  if (job.error || reviews.error || estimate.error || existingLink.error || !job.data) return result('blocked', 'Could not verify this enquiry and its latest Office review.');
  const j = job.data;
  const latest = (reviews.data?.[0]?.metadata as { outcome?: string } | null)?.outcome ?? null;
  if (review === 'no_insulation') {
    const blocker = noInsulationOfferBlocker({ source: j.source, stage: j.stage, outcome: j.eligibility_outcome, decisionSource: j.eligibility_decision_source, reviewRequired: !!j.eligibility_review_required, latestReview: latest });
    if (blocker) return result('blocked', blocker);
  } else {
    if (j.source !== 'base44' || !['new_enquiry', 'eligibility_review', 'preliminary_estimate_ready'].includes(j.stage)) return result('blocked', 'This website enquiry is no longer awaiting an offer.');
    if (latest !== 'below_r2') return result('blocked', 'The latest Office photo review is not “below R2”.');
    if (!['likely_eligible', 'needs_onsite_confirmation'].includes(j.eligibility_outcome ?? '') || j.eligibility_review_required || !['admin', 'system'].includes(j.eligibility_decision_source ?? '')) return result('blocked', 'Record the Office eligibility decision first — photos alone never decide eligibility.');
  }
  const expected = review === 'below_r2' ? 'present' : 'none';
  if (mode === 'prepare') {
    const prepared = await refreshIndicativeEstimate(jobId, { officeReview: review });
    if (!prepared.estimate || prepared.insulationDeclared !== expected) return result('blocked', prepared.reason ?? 'The reviewed estimate could not be prepared.', true);
    await syncStep3(jobId, actorId);
    // A prepare call can return without an estimate/link; verify persisted facts before claiming success.
    const [current, link] = await Promise.all([
      admin.from('indicative_estimates').select('id,insulation_declared').eq('job_id', jobId).eq('status', 'current').maybeSingle(),
      admin.from('customer_estimate_links').select('id,status,expires_at,current_estimate_id').eq('job_id', jobId).eq('purpose', 'step3_estimate').eq('status', 'active').maybeSingle(),
    ]);
    if (current.error || link.error || !current.data || current.data.insulation_declared !== expected || !linkUsable(link.data) || link.data?.current_estimate_id !== current.data.id) return result('blocked', 'The reviewed estimate and secure link could not be verified. Refresh this enquiry before continuing.', true);
    return result('skipped', 'Reviewed estimate and secure link prepared using current pricing. No email was sent. Preview the email before sending.');
  }
  if (estimate.data?.insulation_declared !== expected || !linkUsable(existingLink.data)) return result('blocked', 'Prepare the reviewed estimate and secure link first. The homeowner’s original answer will be preserved.', true);
  if (review === 'below_r2') return sendExistingInsulationSaveSpot(jobId, actorId, mode === 'preview');
  const [sent] = await sendSaveMySpot([jobId], actorId, mode === 'preview' ? { mode: 'preview' } : {});
  return sent ?? result('uncertain', 'No send result was returned. Check communication history before retrying.');
}
