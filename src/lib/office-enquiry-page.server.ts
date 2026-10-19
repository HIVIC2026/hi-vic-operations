import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { loadEnquiryGroups } from './enquiry-groups.server';
import type { EnquiryPageView } from './enquiry-list-page.core';

type Page = { ids: string[]; total: number; page: number; pageSize: number; totalPages: number; counts: Record<EnquiryPageView, number> };
export async function loadOfficeEnquiryPage(view: EnquiryPageView, search: string, page: number) {
  const { data, error } = await admin.rpc('office_enquiry_page' as never, { p_view: view, p_search: search, p_page: page } as never);
  if (error) throw new Error(`Enquiries could not load: ${error.message}`);
  const result = data as unknown as Page;
  if (!result || !Array.isArray(result.ids) || result.ids.length > 50) throw new Error('Invalid enquiry page');
  const details = result.ids.length ? await loadEnquiryGroups(result.ids) : { rows: [] };
  const byId = new Map(details.rows.map(row => [row.id, row]));
  return { ...result, rows: result.ids.flatMap(id => { const row = byId.get(id); return row ? [row] : []; }) };
}