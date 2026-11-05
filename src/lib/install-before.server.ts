// Authorised callers only. No provider calls, pricing, approvals or sends.
import {supabaseAdmin as admin} from '@/integrations/supabase/client.server';
import {installBeforePlan, type BeforeArea} from './install-before.core';
type MeasurementRow={external_source:string|null;external_id:string|null;zones:unknown}|null;
/** `known` (join 4 Nov 2026, #135 read budget): the job page bundle already holds the current measurement — pass it so only the reviews are read. */
export async function readInstallBeforePlan(jobId:string,known?:{measurement:MeasurementRow}) {
 const measurement=known?{data:known.measurement,error:null}:await admin.from('ceiling_measurements').select('external_source,external_id,zones').eq('job_id',jobId).eq('is_current',true).maybeSingle();
 // No recorded areas → no plan line whatever the office reviewed (installBeforePlan: unknownAreas), so the reviews are not read.
 if(measurement.error)throw new Error('Ceiling areas could not be read.');
 const m=measurement.data;
 const zones:unknown[]=Array.isArray(m?.zones)?m.zones:[];
 const areas:BeforeArea[]=zones.filter((z):z is Record<string,unknown>=>!!z&&typeof z==='object'&&!Array.isArray(z)).map(z=>{
  const name=typeof z['name']==='string'?z['name']:typeof z['label']==='string'?z['label']:null;
  return {name,beforeVideo:null,wholeAreaPhoto:null,backingPhoto:null,depthPhoto:null,present:typeof z['present']==='boolean'?z['present']:z['existing']==='none'?false:z['existing']==='present'?true:null,rejected:false};
 });
 return installBeforePlan(m?.external_source==='mitti'&&!!m.external_id,areas);
}