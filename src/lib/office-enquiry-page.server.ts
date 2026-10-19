import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { loadEnquiryGroups } from './enquiry-groups.server';
import type { EnquiryPageView } from './enquiry-list-page.core';

type Page = { ids: string[]; total: number; page: number; pageSize: number; totalPages: number; counts: Record<EnquiryPageView, number> };
export async function loadOfficeEnquiryPage(view: EnquiryPageView, search: string, page: number) {
  const { data, error } = await admin.rpc('office_enquiry_page', { p_view: view, p_search: search, p_page: page });
  if (error) throw new Error(`Enquiries could not load: ${error.message}`);
  const result = data as unknown as Page;
  if (!result || !Array.isArray(result.ids) || result.ids.length > 50) throw new Error('Invalid enquiry page');
  const details = result.ids.length ? await loadEnquiryGroups(result.ids) : { rows: [] };
  const { data: facts, error: factsError } = result.ids.length ? await admin.from('office_enquiry_index').select('id,enquiry_status,needs_first_response,review_outcome').in('id', result.ids) : { data: [], error: null };
  if (factsError) throw new Error('Could not verify enquiry page facts.');
  const factById = new Map((facts ?? []).map(row => [row.id, row]));
  const byId = new Map(details.rows.map(row => [row.id, row]));
  return { ...result, rows: result.ids.flatMap(id => { const row = byId.get(id); const fact = factById.get(id); return row ? [{ ...row, status: (fact?.enquiry_status ?? row.status) as typeof row.status, needsFirstResponse: fact?.needs_first_response ?? true, nextAction: row.mediaOutcome === 'no_insulation' || row.mediaOutcome === 'below_r2' ? 'Ready to offer Save My Spot' : row.mediaOutcome === 'unclear' ? 'Request more photos / video' : row.nextAction }] : []; }) };
}