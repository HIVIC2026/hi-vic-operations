import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';

/** Shared SELECT-only exclusion for Office lists; direct job history remains accessible. */
export async function onsiteOnlyOfficeJobIds(admin: SupabaseClient<Database>): Promise<Set<string>> {
  const ids=new Set<string>();
  for(let from=0;;from+=1000){
    const {data,error}=await admin.from('office_enquiry_index').select('id').eq('office_bucket','onsite_wait').order('id').range(from,from+999);
    if(error) throw new Error('Could not check onsite-only enquiries. Please try again.');
    for(const row of data??[]) if(row.id) ids.add(row.id);
    if(!data || data.length<1000) return ids;
  }
}