// Authorised callers only. No provider calls, pricing, approvals or sends.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import {installBeforePlan, type BeforeArea} from './install-before.core';
export async function readInstallBeforePlan(jobId:string) {
 const [measurement,reviews]=await Promise.all([
  admin.from('ceiling_measurements').select('external_source,external_id,zones').eq('job_id',jobId).eq('is_current',true).maybeSingle(),
  admin.from('evidence_requirements').select('label,status,category,area_key').eq('job_id',jobId).in('status',['rejected','verified']),
 ]);
 if(measurement.error||reviews.error)throw new Error('BEFORE evidence could not be checked – office review required.');
 const m=measurement.data;
 const zones:unknown[]=Array.isArray(m?.zones)?m.zones:[];
 const areas:BeforeArea[]=zones.filter((z):z is Record<string,unknown>=>!!z&&typeof z==='object'&&!Array.isArray(z)).map(z=>{
  const name=typeof z['name']==='string'?z['name']:typeof z['label']==='string'?z['label']:null;
  const matching=(reviews.data??[]).filter(r=>r.area_key===z['key']||(!r.area_key&&!!name&&r.label.toLowerCase().includes(name.toLowerCase())));
  const isBefore=(r:{label:string;category:string})=>r.category==='before_ceiling_space'||/before|original condition|existing.*depth|old.*insulation.*(?:ruler|backing)/i.test(r.label);
  const beforeRejected=matching.some(r=>r.status==='rejected'&&isBefore(r));
  const accepted=matching.some(r=>r.status==='verified'&&r.category==='before_ceiling_space');
  return {name,beforeVideo:accepted||z['beforeVideo']===true,wholeAreaPhoto:accepted||z['wholeAreaPhoto']===true,backingPhoto:accepted||z['backingPhoto']===true,depthPhoto:accepted||z['depthPhoto']===true,present:typeof z['present']==='boolean'?z['present']:null,rejected:beforeRejected};
 });
 return installBeforePlan(m?.external_source==='mitti'&&!!m.external_id,areas);
}