import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { catchupBlocker, catchupRoute, catchupMediaState, catchupInsulation, sameCatchupEnquiry } from './office-first-response.core';
import { SUPPRESSING_EVENTS, withUnsubscribe } from './emailsafety.core';
import { groupBMediaForJob } from './group-b-media.server';
import { groupBGlobalsOn, realSendingOn, resendDeliveryAdapter } from './hot-leads-send.server';
import { savedPriceFromEstimate, LAUNCH_CAMPAIGN } from './launch-campaign.core';
import { declaredExtras } from './enquiry.core';
import { joAreaBasis } from './jo-area-basis.core';
import { discountIsWholeVeecs } from './estimate.core';
import { linkUsable } from './estimatelink.core';
import { renderJoOutcomeEmail } from './jo-outcome-email.core';
import { CUSTOMER_BASE } from './engagement.core';
import { testRecipientBoundary } from './comms-test-recipient.core';
import { unsubscribeUrlForJob } from './emailsafety.server';
import { recordCommunication } from './comms.server';
import { DeliveryRejectedError } from './delivery.core';

/** Fail-closed current history read; no write, link issuance or eligibility change. */
export async function readCatchup(jobId: string, ownReservation?: string) {
  const [index, job, sends, comms, consent, opt, response, suppressed, work] = await Promise.all([
    admin.from('office_enquiry_index').select('*').eq('id', jobId).maybeSingle(),
    admin.from('jobs').select('property_id,hold_reason,eligibility_review_required,eligibility_decision_source,estimated_area_m2,estimated_area_unknown,properties(enrichment)').eq('id', jobId).maybeSingle(),
    admin.from('customer_email_sends').select('id,status').eq('job_id', jobId),
    admin.from('job_communications').select('id').eq('job_id', jobId).eq('direction', 'outbound').eq('channel', 'email').eq('visibility', 'customer'),
    admin.from('owner_contact_consents').select('consent_status').eq('job_id', jobId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    admin.from('customer_email_optouts').select('opted_out_at').eq('job_id', jobId).maybeSingle(),
    admin.from('lead_campaign_responses').select('opted_out_at,spot_saved_at').eq('job_id', jobId).maybeSingle(),
    admin.from('customer_engagement_events').select('id').eq('job_id', jobId).in('event_type', SUPPRESSING_EVENTS).limit(1),
    admin.from('post_intake_work').select('id').eq('job_id', jobId).in('status', ['queued', 'processing', 'retry']).limit(1),
  ]);
  if ([index, job, sends, comms, consent, opt, response, suppressed, work].some(r => r.error)) throw new Error('Could not verify first-response safety records');
  const i = index.data, j = job.data;
  if (!i || !j) throw new Error('Enquiry not found');
  const email = i.owner_email?.trim().toLowerCase() ?? null;
  // Read every same-recipient job, but only same-property/enquiry siblings suppress this Office action.
  let recipientAnswered = false;
  if (email) for (let offset = 0; ; offset += 50) {
    const siblings = await admin.from('office_enquiry_index').select('id,property_key,external_enquiry_id,source').eq('email_key', email).neq('id', jobId).order('id').range(offset, offset + 49);
    if (siblings.error) throw new Error('Could not verify same-recipient enquiries');
    const rows = siblings.data ?? [];
    const siblingIds = rows.flatMap(x => x.id ? [x.id] : []);
    const properties = siblingIds.length ? await admin.from('jobs').select('id,property_id').in('id', siblingIds) : { data: [], error: null };
    if (properties.error || properties.data?.length !== siblingIds.length) throw new Error('Could not verify sibling property identities');
    const ids = rows.filter(x => sameCatchupEnquiry(
      { propertyId: j.property_id, propertyKey: i.property_key, enquiryId: i.external_enquiry_id, source: i.source },
      { propertyId: properties.data?.find(p => p.id === x.id)?.property_id ?? null, propertyKey: x.property_key, enquiryId: x.external_enquiry_id, source: x.source },
    )).flatMap(x => x.id ? [x.id] : []);
    if (ids.length) {
      const [s, c] = await Promise.all([
        admin.from('customer_email_sends').select('id').in('job_id', ids).in('status', ['sent', 'delivered', 'sending', 'delivered_unrecorded', 'sending_unknown']).limit(1),
        admin.from('job_communications').select('id').in('job_id', ids).eq('direction', 'outbound').eq('channel', 'email').eq('visibility', 'customer').limit(1),
      ]);
      if (s.error || c.error) throw new Error('Could not verify same-recipient correspondence');
      recipientAnswered ||= !!s.data?.length || !!c.data?.length;
    }
    if (rows.length < 50) break;
  }
  const blocker = catchupBlocker({
    jobNumber: i.job_number, bucket: i.office_bucket, needsFirstResponse: i.needs_first_response === true,
    source: i.source ?? '', channel: i.channel ?? '', stage: i.stage ?? '', email,
    deleted: !!i.deleted_at, archived: !!i.qa_archived_at, removed: i.removed !== false, holdReason: j.hold_reason,
    answered: !!sends.data?.some(x => ['sent', 'delivered'].includes(x.status)), outbound: !!comms.data?.length,
    inFlight: !!sends.data?.some(x => x.id !== ownReservation && !['failed', 'sent', 'delivered'].includes(x.status)), recipientAnswered,
    consent: consent.data?.consent_status === 'granted', optedOut: !!opt.data?.opted_out_at || !!response.data?.opted_out_at,
    suppressed: !!suppressed.data?.length || !!response.data?.spot_saved_at, workActive: !!work.data?.length,
    outcome: i.eligibility_outcome, decisionSource: j.eligibility_decision_source, reviewRequired: j.eligibility_review_required,
  });
  return { index: i, job: j, email, blocker };
}

async function prepareCatchup(jobId: string, ownReservation?: string) {
  const initial = await readCatchup(jobId, ownReservation);
  if (initial.blocker) return { blocker: initial.blocker };
  const [originalMedia, documents, evidence, estimate, link, config] = await Promise.all([
    groupBMediaForJob(jobId),
    admin.from('documents').select('kind,mime_type,storage_path').eq('job_id', jobId).eq('kind', 'intake_media'),
    admin.from('evidence_files').select('mime_type,storage_path').eq('job_id', jobId),
    admin.from('indicative_estimates').select('id,area_m2,area_source,insulation_declared,scenarios,snapshot').eq('job_id', jobId).eq('status', 'current').maybeSingle(),
    admin.from('customer_estimate_links').select('id,token,status,expires_at').eq('job_id', jobId).eq('purpose', 'step3_estimate').eq('status', 'active').maybeSingle(),
    admin.from('retail_estimator_settings').select('indicative_veec_value,piesa_assessment_inc_gst,ap_management_inc_gst').eq('is_current', true).maybeSingle(),
  ]);
  if (estimate.error || link.error || config.error) return { blocker: 'Estimate, link or pricing read failed' };
  const property = initial.job.properties as { enrichment?: { base44?: { raw?: { answers?: Record<string, unknown> } } } } | null;
  const insulation = catchupInsulation(declaredExtras(property?.enrichment?.base44?.raw?.answers ?? null).existing_insulation);
  const media = catchupMediaState(jobId, originalMedia, [...(documents.data ?? []), ...(evidence.data ?? []).map(f => ({ ...f, kind: 'intake_media' }))], !!documents.error || !!evidence.error);
  const route = catchupRoute(insulation, initial.index.eligibility_outcome, media);
  if (!route) return { blocker: 'Media uncertain/pending or unsupported current insulation facts' };
  if (!(await groupBGlobalsOn()) || (route === 'offer' && !(await realSendingOn()))) return { blocker: 'Customer sending switches are off' };
  const est = estimate.data, price = savedPriceFromEstimate(est), l = link.data;
  if (!price || !est || !l || !linkUsable(l) || !config.data) return { blocker: 'Valid current estimate and secure link required' };
  const ownerArea = initial.job.estimated_area_unknown ? null : Number(initial.job.estimated_area_m2);
  const area = joAreaBasis({ areaSource: est.area_source, areaM2: price.areaM2, ownerAreaM2: ownerArea });
  if (!area.ok) return { blocker: area.reason };
  if (route === 'offer' && !area.ceilingSizeKnown) return { blocker: 'Offer requires actual declared ceiling size matching current estimate' };
  if (price.insulation !== insulation) return { blocker: 'Estimate insulation differs from current declaration' };
  const snap = est.snapshot as { settings?: { piesa_assessment_inc_gst?: number; ap_management_inc_gst?: number }; scenarios?: { by_access?: { standard?: { installation?: number } } }[] } | null;
  const installation = snap?.scenarios?.[0]?.by_access?.standard?.installation;
  const piesa = snap?.settings?.piesa_assessment_inc_gst, ap = snap?.settings?.ap_management_inc_gst;
  if (![installation, piesa, ap, price.total, price.discount, price.gross].every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0) || piesa !== Number(config.data.piesa_assessment_inc_gst) || ap !== Number(config.data.ap_management_inc_gst) || !discountIsWholeVeecs(price.discount, price.total, Number(config.data.indicative_veec_value))) return { blocker: 'Current itemised pricing/whole-VEEC estimate required' };
  if (!initial.email) return { blocker: 'Missing recipient' };
  const boundary = testRecipientBoundary(initial.email, initial.index.source);
  if (boundary.status === 'blocked') return { blocker: boundary.reason };
  const url = `${CUSTOMER_BASE}/estimate/${l.token}`;
  const mail = renderJoOutcomeEmail({ outcome: route === 'offer' ? 'likely_eligible' : 'needs_onsite_confirmation', insulation, ceilingSizeKnown: area.ceilingSizeKnown, mediaAlreadyReceived: route === 'acknowledge',
    recipient: { firstName: initial.index.owner_name?.trim().split(/\s+/)[0] || 'there', propertyAddress: initial.index.property_address ?? '', enquiryReference: initial.index.job_number ?? '' },
    figures: { veuRebate: price.discount, customerTotal: price.total, totalBeforeRebate: price.gross, installation: Number(installation), piesaFee: Number(piesa), apFee: Number(ap), ceilingAreaM2: area.areaM2, areaEstimated: area.areaEstimated },
    links: { saveMySpotUrl: `${url}/campaign`, uploadMediaUrl: `${url}/video`, reviewResultUrl: url, calculatorUrl: `${url}/calculator` },
  });
  if (!mail) return { blocker: 'No approved template applies' };
  return { blocker: null, initial, route, mail, linkId: l.id, estimateId: est.id };
}

/** Only the authenticated admin RPC calls this; never normal automation or a public route. */
export async function sendOfficeFirstResponse(jobId: string, actorId: string) {
  const result = (status: string, reason: string) => ({ jobId, status, reason });
  const prepared = await prepareCatchup(jobId);
  if (prepared.blocker || !prepared.initial || !prepared.mail || !prepared.initial.email) return result('skipped', prepared.blocker ?? 'Preparation unavailable');
  const key = `${LAUNCH_CAMPAIGN}:${prepared.route === 'offer' ? 'save_my_spot' : 'insulation_details'}:${jobId}`;
  // Same unique reservation as normal senders. Never re-reserve an existing attempt in catch-up.
  const reservation = await admin.from('customer_email_sends').insert({ job_id: jobId, estimate_link_id: prepared.linkId, purpose: LAUNCH_CAMPAIGN, idempotency_key: key, status: 'sending' }).select('id').single();
  if (reservation.error || !reservation.data) return result('skipped', 'Prior attempt or concurrent send — check history');
  const id = reservation.data.id;
  const write = async (status: string, error: string | null, providerId?: string | null, communicationId?: string) => {
    const r = await admin.from('customer_email_sends').update({ status, error, provider: 'resend', ...(providerId ? { provider_message_id: providerId } : {}), ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}), ...(communicationId ? { communication_id: communicationId } : {}) }).eq('id', id).eq('status', 'sending').select('id');
    if (r.error || !r.data?.length) throw new Error('Delivery outcome could not be recorded — do not retry');
  };
  let attempted = false, providerId: string | null = null;
  try {
    const unsubscribe = await unsubscribeUrlForJob(jobId);
    // Re-render from fresh facts immediately before provider call, ignoring only our own reservation.
    const fresh = await prepareCatchup(jobId, id);
    if (fresh.blocker || !fresh.mail || !fresh.initial || fresh.initial.email !== prepared.initial.email || fresh.route !== prepared.route || fresh.estimateId !== prepared.estimateId || fresh.linkId !== prepared.linkId) {
      await write('failed', fresh.blocker ?? 'Current facts changed');
      return result('blocked', fresh.blocker ?? 'Current facts changed');
    }
    const outgoing = withUnsubscribe(fresh.mail, unsubscribe);
    attempted = true;
    const delivered = await resendDeliveryAdapter().deliver({ to: prepared.initial.email, subject: outgoing.subject, html: outgoing.html, text: outgoing.plainText, idempotencyKey: key, purpose: LAUNCH_CAMPAIGN });
    providerId = delivered.providerMessageId ?? null;
    if (!providerId) throw new Error('Provider acceptance lacks message ID');
    const communicationId = await recordCommunication({ jobId, direction: 'outbound', channel: 'email', recipients: [prepared.initial.email], subject: outgoing.subject, body: outgoing.plainText, provider: 'resend', providerMessageId: providerId, visibility: 'customer', sourceEvent: LAUNCH_CAMPAIGN, sourceReference: key, createdBy: actorId, deliveryStatus: 'sent' });
    await write('sent', null, providerId, communicationId);
    return result('sent', 'Provider accepted; both delivery records saved');
  } catch (error) {
    const definite = !attempted || error instanceof DeliveryRejectedError;
    await write(definite ? 'failed' : 'delivered_unrecorded', error instanceof Error ? error.message.slice(0, 300) : 'Unknown delivery error', providerId).catch(() => null);
    return result(definite ? 'failed' : 'uncertain', definite ? 'Send failed — inspect record' : 'Outcome uncertain — do not retry');
  }
}