// Authorised callers only. No provider calls, pricing, approvals or sends.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import {installBeforePlan, type BeforeArea} from './install-before.core';
export async function readInstallBeforePlan(jobId:string) {
 const [measurement,reviews]=await Promise.all([
  admin.from('ceiling_measurements').select('external_source,external_id,zones').eq('job_id',jobId).eq('is_current',true).maybeSingle(),
  admin.from('evidence_requirements').select('label,status,category').eq('job_id',jobId).eq('status','rejected'),
 ]);
 if(measurement.error||reviews.error)throw new Error('BEFORE evidence could not be checked – office review required.');
 const m=measurement.data;
 const zones=Array.isArray(m?.zones)?m.zones:[];
 const areas:BeforeArea[]=zones.filter((z):z is Record<string,unknown>=>!!z&&typeof z==='object'&&!Array.isArray(z)).map(z=>{
  const name=typeof z['name']==='string'?z['name']:typeof z['label']==='string'?z['label']:null;
  const beforeRejected=(reviews.data??[]).some(r=>/before|existing.*depth|old.*insulation.*ruler/i.test(r.label)&&(!name||r.label.toLowerCase().includes(name.toLowerCase())||!zones.some(other=>{const a=other as Record<string,unknown>;const n=a['name']??a['label'];return typeof n==='string'&&r.label.toLowerCase().includes(n.toLowerCase());})));
  return {name,beforeVideo:z['beforeVideo']===true,depthPhoto:z['depthPhoto']===true,present:typeof z['present']==='boolean'?z['present']:null,rejected:beforeRejected};
 });
 return installBeforePlan(m?.external_source==='mitti'&&!!m.external_id,areas);
}