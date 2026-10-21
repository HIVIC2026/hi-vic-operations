import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { loadEnquiryGroups } from './enquiry-groups.server';
import type { EnquiryPageView } from './enquiry-list-page.core';
import { enquiryNextStep, type ResponseCounts, type ResponseState } from './enquiry-response.core';

type Page = { ids: string[]; total: number; page: number; pageSize: number; totalPages: number; counts: Record<EnquiryPageView, number>; responses?: ResponseCounts };
export async function loadOfficeEnquiryPage(view: EnquiryPageView, search: string, page: number) {
  const { data, error } = await admin.rpc('office_enquiry_page', { p_view: view, p_search: search, p_page: page });
  if (error) throw new Error(`Enquiries could not load: ${error.message}`);
  const result = data as unknown as Page;
  if (!result || !Array.isArray(result.ids) || result.ids.length > 50) throw new Error('Invalid enquiry page');
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
