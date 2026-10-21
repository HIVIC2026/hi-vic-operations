import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { renderJobEmailPreview } from './job-email-preview.core';
import { joRecipientFacts } from './followups.server';
import { CUSTOMER_BASE } from './engagement.core';
import { safeReason } from './ineligible-email';
import type { JoOutcome, JoOutcomeEmailInput } from './jo-outcome-email.core';

/** SELECT-only: no estimate refresh, token creation, view tracking or delivery. */
export async function jobEmailPreview(jobId: string) {
  const [job, estimate, reviews] = await Promise.all([
    admin.from('jobs').select('job_number,eligibility_outcome,eligibility_decision_source,eligibility_review_required,eligibility_reason').eq('id', jobId).maybeSingle(),
    admin.from('indicative_estimates').select('area_m2,area_source,insulation_declared,scenarios,snapshot').eq('job_id', jobId).eq('status', 'current').maybeSingle(),
    admin.from('customer_engagement_events').select('metadata').eq('job_id', jobId).eq('event_type', 'intake_media_reviewed').eq('source', 'office').order('occurred_at', { ascending: false }).order('id', { ascending: false }).limit(1),
  ]);
  if (job.error || estimate.error || reviews.error) throw new Error('Could not load the customer email preview.');
  const j = job.data;
  if (!j || j.eligibility_review_required || !['system', 'admin'].includes(j.eligibility_decision_source ?? '')) return { mail: null, reason: 'An official eligibility decision is needed before a customer email can be previewed.' };
  if (!['likely_eligible', 'needs_onsite_confirmation', 'does_not_appear_eligible'].includes(j.eligibility_outcome ?? '')) return { mail: null, reason: 'No approved customer email applies to this result.' };
  const e = estimate.data;
  const snapshot = e?.snapshot as { settings?: { piesa_assessment_inc_gst?: number; ap_management_inc_gst?: number } } | null;
  const scenarios = e?.scenarios as Array<{ by_access?: { standard?: { installation: number; estimated_customer_total: number; pre_discount_total: number; applied_discount: number } } }> | null;
  const standard = scenarios?.[0]?.by_access?.standard;
  const who = await joRecipientFacts(jobId, j.job_number);
  const review = (reviews.data?.[0]?.metadata as { outcome?: string } | undefined)?.outcome;
  // Inert placeholder links: this is an Office preview, not an owner visit.
  const base = `${CUSTOMER_BASE}/estimate/preview-only`;
  const input: JoOutcomeEmailInput = {
    outcome: j.eligibility_outcome as JoOutcome,
    insulation: e?.insulation_declared === 'none' || e?.insulation_declared === 'present' ? e.insulation_declared : 'unknown',
    ceilingSizeKnown: !!e && e.area_source !== 'typical_default',
    deskCheckStatus: review === 'below_r2' || review === 'no_insulation' ? 'looks_eligible' : null,
    recipient: { firstName: who.firstName ?? 'there', propertyAddress: who.address ?? 'your property', enquiryReference: who.reference ?? j.job_number ?? '' },
    reason: safeReason(j.eligibility_reason),
    // Use the renderer's bundled logo fallback, not token artwork or the sample Alex/$2,600 image.
    links: { saveMySpotUrl: `${base}/campaign`, uploadMediaUrl: `${base}/video`, reviewResultUrl: '#preview-result', calculatorUrl: `${base}/calculator` },
    ...(standard && e && snapshot?.settings ? { figures: {
      veuRebate: Number(standard.applied_discount), customerTotal: Number(standard.estimated_customer_total), totalBeforeRebate: Number(standard.pre_discount_total), installation: Number(standard.installation),
      piesaFee: Number(snapshot.settings.piesa_assessment_inc_gst), apFee: Number(snapshot.settings.ap_management_inc_gst), ceilingAreaM2: Number(e.area_m2), areaEstimated: e.area_source === 'typical_default',
    } } : {}),
  };
  const mail = renderJobEmailPreview(input);
  return { mail: mail ? { subject: mail.subject, html: mail.html } : null, reason: mail ? null : 'No approved customer email can be previewed from the current estimate and review.' };
}