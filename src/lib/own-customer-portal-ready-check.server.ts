// Authenticated callers only. Portal declarations never manufacture Mitti completion or accepted evidence.
import { supabaseAdmin as db } from '@/integrations/supabase/client.server';
import { canEnterPrice, PRICE_INCLUDED_OPTIONS, priceCardLocked } from './installer-price.core';
import { portalReadyCheckFacts, portalReadyCheckFileOnJob, PORTAL_READY_CHECK_SOURCE, type PortalReadyCheckInput } from './own-customer-portal-ready-check.core';
import { PRE_READY_CHECK_STAGES } from './installer-new-jobs.core';

const PORTAL_RC_STAGES = [...PRE_READY_CHECK_STAGES, 'ready_check_complete', 'measured_estimate_ready', 'awaiting_quote_acceptance'] as const;

/** Read-only submitted details; uses the same business/job boundary as the rest of the trade page. */
export async function readPortalReadyCheck(jobId: string, userId: string) {
 await (await import('./trade-view.server')).requireTradeJob(userId,jobId);
 const {data:measurement,error}=await db.from('ceiling_measurements').select('external_source,raw_snapshot').eq('job_id',jobId).eq('is_current',true).maybeSingle();
 if(error || measurement?.external_source !== PORTAL_READY_CHECK_SOURCE) throw Error('The portal Ready Check is not available.');
 const price=await (await import('./installer-price.server')).readInstallerPrice(jobId);
 if(!price?.sendToQuote) throw Error('The Ready Check has not been sent for quote yet.');
 const entries=Array.isArray(measurement.raw_snapshot)?measurement.raw_snapshot as {label:string;value:string|null}[]:[];
 return {submittedAt:price.setAt,entries:entries.filter(e=>e.value != null && String(e.value).trim() !== '' && !/quoted price|price inc GST/i.test(e.label))};
}

export async function requirePortalReadyCheck(jobId: string, userId: string) {
 const { data: job, error } = await db.from('jobs').select('channel, originating_installer_business_id, stage, deleted_at, qa_archived_at').eq('id', jobId).maybeSingle();
 if (error || !job || job.channel !== 'installer_sourced' || !job.originating_installer_business_id || job.deleted_at || job.qa_archived_at) throw Error('This job is not available.');
 const { data: member, error: me } = await db.from('business_members').select('member_role').eq('business_id', job.originating_installer_business_id).eq('user_id', userId).eq('active', true).maybeSingle();
 if (me || !canEnterPrice(member?.member_role ?? null)) throw Error('Only this business’s owner or office can enter Ready Check details and price.');
 if (!PORTAL_RC_STAGES.some(stage => stage === job.stage)) throw Error('The Ready Check details cannot be changed at this stage.');
 const [{ latestQuoteSentAt }, { readInstallerPriceState }] = await Promise.all([import('./installer-price-set.server'), import('./installer-price.server')]);
 if (priceCardLocked({ quoteSentAt: await latestQuoteSentAt(jobId), newQuoteRequestedAt: (await readInstallerPriceState(jobId)).newQuoteRequestedAt })) throw Error('The quote has already been sent.');
 return job;
}

export async function savePortalReadyCheck(jobId: string, userId: string, input: PortalReadyCheckInput) {
 const job = await requirePortalReadyCheck(jobId, userId);
 const [{ data: current, error }, { data: previous, error: pe }] = await Promise.all([
  db.from('ceiling_measurements').select('id,status,accepted_by,external_source,external_id').eq('job_id',jobId).eq('is_current',true).maybeSingle(),
  db.from('workflow_events').select('details').eq('job_id',jobId).eq('event_type','portal_ready_check_saved').order('created_at',{ascending:false}).limit(1).maybeSingle(),
 ]);
 if(error || pe) throw Error('The Ready Check could not be read. Try again.');
 if(current?.accepted_by || current?.status === 'complete') throw Error('These measurements are already complete. Ask the office to correct them.');
 // Files are job-owned, MIME/byte verified, private and never marked accepted compliance evidence.
 for(const file of input.files) {
  if(!portalReadyCheckFileOnJob(jobId,file.path)) throw Error('That file is not on this job.');
  await (await import('./upload-safety.server')).verifyStoredUpload('job-files',file.path,file.mime);
  const fileId = await (await import('./mitti-create-claim.core')).stableUuid(`portal-ready-check-file:${jobId}:${file.path}`);
  const {error: fe} = await db.from('documents').upsert({id:fileId,job_id:jobId,kind:file.purpose === 'photo' || file.purpose === 'sketch' ? 'ready_check_photo' : file.purpose === 'aerial' ? 'aerial_image' : file.purpose === 'other' ? 'other' : 'floor_plan',title:file.name,original_name:file.name,storage_path:file.path,mime_type:file.mime,size_bytes:file.size,uploaded_by:userId,source_system:'portal',external_id:file.path},{onConflict:'id'});
  if(fe) throw Error('The file could not be saved. It has been kept; try again.');
 }
 const {logEvent} = await import('./workflow.server');
 // A durable intent preserves the original audit pointer and recovers interrupted price/draft work on Save retry.
 const prior = previous?.details as {unused_mitti_audit_id?: string | null} | null;
 const unusedId = current?.external_source === 'mitti' ? current.external_id : prior?.unused_mitti_audit_id ?? null;
 await logEvent(jobId,userId,'portal_ready_check_saved','Ready Check details saved in the portal',{input,business_id:job.originating_installer_business_id,unused_mitti_audit_id:unusedId,declared_not_verified:true},{internal:true});
 const facts = portalReadyCheckFacts(input);
 const values = {...facts.measure,raw_snapshot:facts.entries,zones:facts.areas,provenance:'hivic_onsite',external_source:PORTAL_READY_CHECK_SOURCE,external_id:`portal:${jobId}`,source_role:'installer' as const,updated_at:new Date().toISOString()};
 const saved = current ? await db.from('ceiling_measurements').update(values as never).eq('id',current.id).eq('is_current',true).neq('status','complete').select('id').maybeSingle() : await db.from('ceiling_measurements').insert({...values,job_id:jobId,status:'draft',is_current:true,created_by:userId} as never).select('id').single();
 if(saved.error || !saved.data) throw Error('The Ready Check could not be saved. Try again.');
 const included: string[] = [PRICE_INCLUDED_OPTIONS[0] ?? 'Ceiling insulation - supply & install'];
 if(input.removalM2>0 && PRICE_INCLUDED_OPTIONS[1]) included.push(PRICE_INCLUDED_OPTIONS[1]);
 await (await import('./installer-price-set.server')).setInstallerPrice(jobId,userId,{priceIncGst:input.priceIncGst,included,notes:input.other},{sendToQuote:true});
 return {ok:true as const};
}

/** Existing scheduled form sweep can repair a saved portal draft without touching Mitti or sending. */
export async function retryPortalReadyCheckQuotes(limit=50) {
 const {data:rows,error}=await db.from('ceiling_measurements').select('job_id,raw_snapshot,jobs!inner(channel,stage,deleted_at,qa_archived_at)').eq('is_current',true).eq('external_source',PORTAL_READY_CHECK_SOURCE).eq('jobs.channel','installer_sourced').is('jobs.deleted_at',null).is('jobs.qa_archived_at',null).in('jobs.stage',[...PORTAL_RC_STAGES]).order('updated_at',{ascending:true}).limit(limit);
 if(error) throw Error('Portal Ready Check quotes could not be read.');
 for(const row of rows??[]) {
  const price=await (await import('./installer-price.server')).readInstallerPrice(row.job_id);
  if(!price?.sendToQuote)continue;
  const entries=Array.isArray(row.raw_snapshot)?row.raw_snapshot as {label:string;value:string|null}[]:[];
  await (await import('./ready-check-basics.server')).checkReadyCheckBasics(row.job_id,null,entries,false,`portal:${row.job_id}`);
  await (await import('./installer-quote.server')).draftInstallerQuoteFromReadyCheck(row.job_id,null,entries,`portal:${row.job_id}`);
 }
}