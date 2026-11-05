import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import { priceChangeFromEvent, pendingPriceChange } from './installer-price-change.core';

export async function readPriceChange(jobId: string) {
  const { data, error } = await admin.from('workflow_events').select('details,created_at').eq('job_id',jobId).eq('event_type','installer_price_set').order('created_at',{ascending:false}).limit(1).maybeSingle();
  if(error) throw new Error('Price change history could not be read.');
  return data ? priceChangeFromEvent(data.details,data.created_at) : null;
}
/** Read only; Office Send keeps its existing accepted/payment/stage blockers. */
export async function pendingChangeFor(jobId: string) {
  const [change,{data,error}] = await Promise.all([readPriceChange(jobId),admin.from('quotes').select('sent_at').eq('job_id',jobId).eq('kind','installation').not('sent_at','is',null).order('sent_at',{ascending:false}).limit(1).maybeSingle()]);
  if(error) throw new Error('Quote send history could not be read.');
  return pendingPriceChange(change,data?.sent_at ?? null) ? change : null;
}