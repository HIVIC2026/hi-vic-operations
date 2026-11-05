import { supabaseAdmin as db } from '@/integrations/supabase/client.server';
import { OWN_MITTI_REQUEST_EVENT, ownCustomerMittiAllowed } from './own-customer-mitti-choice.core';

/** Durable choice; every creator and recovery path checks this before provider work. */
export async function ownMittiChoice(jobId: string) {
  const {data,error}=await db.from('workflow_events').select('event_type').eq('job_id',jobId).in('event_type',[OWN_MITTI_REQUEST_EVENT,'portal_ready_check_saved']);
  if(error) throw Error('The Ready Check choice could not be read. Try again.');
  return {requested:(data??[]).some(e=>e.event_type===OWN_MITTI_REQUEST_EVENT),portalSaved:(data??[]).some(e=>e.event_type==='portal_ready_check_saved')};
}

export async function ownMittiStatus(jobId: string,userId: string) {
  await (await import('./trade-view.server')).requireTradeJob(userId,jobId);
  const [choice,{data:m,error}]=await Promise.all([
    ownMittiChoice(jobId),
    db.from('ceiling_measurements').select('external_source,external_id').eq('job_id',jobId).eq('is_current',true).maybeSingle(),
  ]);
  if(error) throw Error('The Ready Check form could not be read. Try again.');
  return {...choice,auditId:m?.external_source==='mitti' ? m.external_id??null : null};
}

export async function requestOwnMitti(jobId: string,userId: string) {
  await (await import('./own-customer-portal-ready-check.server')).requirePortalReadyCheck(jobId,userId);
  const current=await ownMittiStatus(jobId,userId);
  if(current.portalSaved) throw Error('The Ready Check details have already been entered in the portal.');
  if(!current.requested) {
    const {stableUuid,isUniqueViolation}=await import('./mitti-create-claim.core');
    const {error}=await db.from('workflow_events').insert({id:await stableUuid(`own-customer-mitti-request:${jobId}`),job_id:jobId,actor_id:userId,event_type:OWN_MITTI_REQUEST_EVENT,summary:'Installer chose the on-site Mitti Ready Check',details:{},internal:true});
    if(error && !isUniqueViolation(error)) throw Error('The Ready Check choice could not be saved. Try again.');
  }
  if(!current.auditId) {
    const {runAfterResponse}=await import('./background.server');
    runAfterResponse(async()=> {
      const {readyCheckFormFacts,runReadyCheckFormCreation,testAssignee}=await import('./mitti-create.server');
      const f=await readyCheckFormFacts(jobId);
      if(!f || !f.installerUserId || !ownCustomerMittiAllowed({channel:f.job.channel,...await ownMittiChoice(jobId)})) return;
      const {immediateSkipReason}=await import('./mitti-immediate.core');
      if(immediateSkipReason(f)) return;
      await runReadyCheckFormCreation(jobId,userId,await testAssignee(f.job.source,f.installerUserId));
    });
  }
  return {...current,requested:true};
}