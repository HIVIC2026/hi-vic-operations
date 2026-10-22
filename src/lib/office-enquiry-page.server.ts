import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { loadEnquiryGroups } from './enquiry-groups.server';
import type { EnquiryPageView } from './enquiry-list-page.core';
import { enquiryNextStep, type ResponseCounts, type ResponseState } from './enquiry-response.core';
import { OFFICE_PENDING_PHOTOS_FILTER, OFFICE_REVIEW_FILTER, officeReviewSearch } from './office-review.core';

type Page = { ids: string[]; total: number; page: number; pageSize: number; totalPages: number; counts: Record<EnquiryPageView, number>; responses?: ResponseCounts };
export async function loadOfficeEnquiryPage(view: EnquiryPageView, search: string, page: number) {
  const indexRead = (filter: string, head = false) => {
    let query = admin.from('office_enquiry_index').select('id', { count: 'exact', head })
      .in('source', ['base44', 'portal']).eq('channel', 'hivic_sourced').or(filter);
    const searchFilter = officeReviewSearch(search);
    if (searchFilter) query = query.or(searchFilter);
    return query;
  };
  const [rpc, reviewCount, photoCount] = await Promise.all([
    admin.rpc('office_enquiry_page', { p_view: view, p_search: search, p_page: page }),
    indexRead(OFFICE_REVIEW_FILTER, true), indexRead(OFFICE_PENDING_PHOTOS_FILTER, true),
  ]);
  const { data, error } = rpc;
  if (error) throw new Error(`Enquiries could not load: ${error.message}`);
  if (reviewCount.error || photoCount.error || reviewCount.count == null || photoCount.count == null) throw new Error('Could not verify Office review counts.');
  let result = data as unknown as Page;
  if (!result || !Array.isArray(result.ids) || result.ids.length > 50) throw new Error('Invalid enquiry page');
  result = { ...result, counts: { ...result.counts, needs_attention: reviewCount.count, photos: photoCount.count } };
  // Exact server paging over one predicate, not a merge of two separately paginated lists.
  if (view === 'needs_attention' || view === 'photos') {
    const total = view === 'photos' ? photoCount.count : reviewCount.count;
    const totalPages = Math.max(1, Math.ceil(total / 50));
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const selected = await indexRead(view === 'photos' ? OFFICE_PENDING_PHOTOS_FILTER : OFFICE_REVIEW_FILTER)
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range((currentPage - 1) * 50, currentPage * 50 - 1);
    if (selected.error || !selected.data || selected.count !== total) throw new Error('Office review changed while loading. Refresh the list before taking action.');
    const ids = selected.data.map(row => {
      if (!row.id) throw new Error('Invalid Office review record.');
      return row.id;
    });
    result = { ...result, ids, total, totalPages, page: currentPage, pageSize: 50 };
  }
  const [details, { data: facts, error: factsError }] = await Promise.all([
    result.ids.length ? loadEnquiryGroups(result.ids) : Promise.resolve({ rows: [] }),
    result.ids.length
    ? admin.from('office_enquiry_index').select('id,enquiry_status,needs_first_response,review_outcome,media_to_review,media_count,response_state,latest_attempt_status,latest_attempt_at,more_photos_requested').in('id', result.ids)
    : Promise.resolve({ data: [], error: null }),
  ]);
  if (factsError) throw new Error('Could not verify enquiry page facts.');
  const factById = new Map((facts ?? []).map(row => [row.id, row]));
  const byId = new Map(details.rows.map(row => [row.id, row]));
  return {
    ...result,
    responses: result.responses ?? null,
    rows: result.ids.flatMap(id => {
      const row = byId.get(id); const fact = factById.get(id);
      if (!row || !fact) throw new Error('An enquiry changed while its page was loading. Refresh the list before taking action.');
      const status = (fact.enquiry_status ?? row.status) as typeof row.status;
      const next = enquiryNextStep({ status, mediaToReview: fact.media_to_review === true, reviewOutcome: fact.review_outcome ?? null, morePhotosRequested: fact.more_photos_requested === true, mediaCount: Number(fact.media_count ?? 0), fallback: row.nextAction });
      return [{
        ...row, status, needsFirstResponse: fact.needs_first_response === true,
        mediaOutcome: (fact.review_outcome ?? null) as typeof row.mediaOutcome,
        mediaCount: Number(fact.media_count ?? 0),
        responseState: (fact.response_state ?? 'none') as ResponseState,
        latestAttemptStatus: fact.latest_attempt_status ?? null, latestAttemptAt: fact.latest_attempt_at ?? null,
        mediaToReview: fact.media_to_review === true, nextParty: next.party, nextAction: next.label,
      }];
    }),
  };
}
