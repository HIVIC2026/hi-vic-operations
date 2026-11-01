import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import type {SupabaseClient} from '@supabase/supabase-js';
const db=admin as unknown as SupabaseClient;
/** Only called after office-admin/own-business-admin authorization; never generic worker lists. */
export async function privateBirthDates(workerIds:string[]):Promise<Map<string,string>>{
 const out=new Map<string,string>();
 for(let i=0;i<workerIds.length;i+=200){
  const r=await db.from('partner_worker_identity').select('worker_id,date_of_birth').in('worker_id',workerIds.slice(i,i+200));
  if(r.error){if(['42P01','PGRST205'].includes(r.error.code))return out;throw Error('Could not read private ESC registration details.');}
  for(const row of r.data??[])out.set(row.worker_id,row.date_of_birth);
 }
 return out;
}