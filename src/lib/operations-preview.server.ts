import type { SupabaseClient } from '@supabase/supabase-js';
import { onsiteOnlyOfficeJobIds } from './insulation-details-office.server';
import type { Database } from '@/integrations/supabase/types';
import { declaredExtras } from './enquiry.core';
import { normaliseInsulation } from './eligibility.core';
import { formatPropertyAddress } from './address';
import { insulationOnly, type StoredAudit } from './enquiry-groups.core';
import { verificationStale, type StoredVerification } from './verified-eligibility.core';
import { SAVE_SPOT_REAL_SEND_APPROVED, INSULATION_DETAILS_REAL_SEND_APPROVED } from './hot-leads.core';
import { buildOperationsPreview, sendingControlState, type OperationInput, type AutomationControl } from './operations-preview.core';
import { officePicks } from './offer-dispatch.core';
type Row = Record<string, unknown>;
type Result = PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
// Same paged explicit-error pattern as loadOffice, without mutation-capable orchestration.
async function all(label: string, read: (from: number, to: number) => Result): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await read(from, from + 999);
    if (error) throw new Error(`Operations preview: ${label} could not load — ${error.message}`);
    rows.push(...(data ?? []) as Row[]);
    if (!data || data.length < 1000) return rows;
  }
}
const text = (v: unknown): string | null => v == null ? null : String(v);
const obj = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const related = (v: unknown): Row => obj(Array.isArray(v) ? v[0] : v);
export async function loadOperationsPreview(admin: SupabaseClient<Database>, jobId?: string) {
  // The same loader serves the full dashboard and the single-job getter; jobId narrows the
  // jobs read first so related-fact batches below fetch one job only. All scoping
  // (business unit, TEST/source exclusions, deleted) is unchanged, so a filtered-out
  // job yields no rows and callers stay fail-closed.
  const onsiteOnly = jobId ? new Set<string>() : await onsiteOnlyOfficeJobIds(admin);
  const jobs = (await all('jobs', (a, b) => {
    let q = admin.from('jobs')
      .select('id, job_number, stage, source, business_unit, channel, offer_dispatch_override, commercial_model, originating_installer_business_id, created_at, last_activity_at, hold_reason, hold_revisit_at, cancelled_reason, installation_completed_at, eligibility_outcome, eligibility_reason, eligibility_decision_source, eligibility_review_required, eligibility_decision_rules, owners(full_name), properties(address_line, suburb, state, postcode, enrichment)')
      .eq('business_unit', 'hivic').is('deleted_at', null).or('source.is.null,source.neq.qa_test');
    if (jobId) q = q.eq('id', jobId);
    return q.order('id').range(a, b);
  })).filter(j=>!onsiteOnly.has(String(j['id'])));
  const ids = jobs.map(j => String(j['id']));
  async function byJobs(label: string, q: (ids: string[], a: number, b: number) => Result) {
    const rows: Row[] = [];
    for (let i = 0; i < ids.length; i += 150) rows.push(...await all(label, (a, b) => q(ids.slice(i, i + 150), a, b)));
    return rows;
  }
  const [campaigns, offers, bookings, readyChecks, measurements, requirements, sends, communications, media, reviews, verifications, quotes, payments, deadlines, stages, handoffs, assignments, cfg, delivery, outboxFailures, xeroFailures, smsUnknown, piesa, rectQuotes, windows, proposals, origins] = await Promise.all([
    byJobs('saved spots', (c,a,b) => admin.from('lead_campaign_responses').select('job_id, spot_saved_at, opted_out_at, video_requested, media_received_at, desk_check_status, queue_priority, created_at').in('job_id',c).order('created_at').order('id').range(a,b)),
    byJobs('offers', (c,a,b) => admin.from('partner_offers').select('job_id, kind, status, offered_at').in('job_id',c).in('status',['pending','accepted']).order('offered_at').order('id').range(a,b)),
    byJobs('bookings', (c,a,b) => admin.from('bookings').select('job_id, kind, status, scheduled_start').in('job_id',c).in('status',['proposed','confirmed','completed']).order('scheduled_start').order('id').range(a,b)),
    byJobs('Ready Check records', (c,a,b) => admin.from('ready_checks').select('id, job_id, version, attended_at, submitted_at').in('job_id',c).order('version').order('id').range(a,b)),
    byJobs('measurements', (c,a,b) => admin.from('ceiling_measurements').select('job_id, accepted_by, accepted_at, status, measured_area_m2').in('job_id',c).eq('is_current',true).order('id').range(a,b)),
    byJobs('evidence requirements', (c,a,b) => admin.from('evidence_requirements').select('job_id, label, status, responsible_role, gate').in('job_id',c).eq('required',true).order('sort').order('id').range(a,b)),
    byJobs('email proof', (c,a,b) => admin.from('customer_email_sends').select('job_id, purpose, idempotency_key, status, sent_at, created_at, error').in('job_id',c).order('created_at').order('id').range(a,b)),
    byJobs('message proof', (c,a,b) => admin.from('job_communications').select('job_id, channel, delivery_status, sent_at, created_at').in('job_id',c).eq('direction','outbound').order('created_at').order('id').range(a,b)),
    byJobs('intake media metadata', (c,a,b) => admin.from('documents').select('job_id').in('job_id',c).eq('kind','intake_media').order('id').range(a,b)),
    byJobs('media reviews', (c,a,b) => admin.from('customer_engagement_events').select('job_id, metadata').in('job_id',c).eq('event_type','intake_media_reviewed').order('occurred_at').order('id').range(a,b)),
    byJobs('verified eligibility', (c,a,b) => admin.from('eligibility_verifications').select('job_id, outcome, ready_check_ref, ready_check_version').in('job_id',c).eq('is_current',true).order('id').range(a,b)),
    byJobs('quotes', (c,a,b) => admin.from('quotes').select('job_id, status, release_state, release_hold_reason, sent_at, accepted_at').in('job_id',c).eq('kind','installation').in('status',['issued','accepted']).order('created_at').order('id').range(a,b)),
    byJobs('payment mirror', (c,a,b) => admin.from('invoice_status').select('job_id, deposit_cleared, effective_status, deposit_due_date').in('job_id',c).order('job_id').range(a,b)),
    byJobs('PIESA deadlines', (c,a,b) => admin.from('job_piesa_deadlines').select('job_id, install_deadline').in('job_id',c).order('job_id').range(a,b)),
    byJobs('stage timestamps', (c,a,b) => admin.from('workflow_events').select('job_id, to_stage, created_at').in('job_id',c).eq('event_type','stage_changed').order('created_at').order('id').range(a,b)),
    byJobs('operational handoff records', (c,a,b) => admin.from('ready_check_acceptances').select('job_id').in('job_id',c).order('id').range(a,b)),
    byJobs('assigned installers', (c,a,b) => admin.from('job_assignments').select('job_id, role, user_id, businesses(name)').in('job_id',c).eq('active',true).eq('role','installer').order('id').range(a,b)),
    admin.from('workflow_settings').select('customer_comms_enabled, auto_send_quote, auto_send_mitti, auto_send_installer, auto_send_rec, offer_dispatch_mode, payment_option_gate_enabled').eq('id',1).maybeSingle(),
    admin.from('customer_delivery_settings').select('enabled').eq('id',1).maybeSingle(),
    byJobs('failed external actions', (c,a,b) => admin.from('external_action_outbox').select('job_id, action_type, last_error_code').in('job_id',c).eq('status','failed').order('id').range(a,b)),
    byJobs('invoice errors', (c,a,b) => admin.from('invoices').select('job_id, last_sync_error').in('job_id',c).not('last_sync_error','is',null).order('id').range(a,b)),
    byJobs('uncertain SMS', (c,a,b) => admin.from('sms_messages').select('job_id, message_type, status, detail, created_at, updated_at').in('job_id',c).in('status',['sent_unknown','sending']).order('created_at').order('id').range(a,b)),
    byJobs('PIESA facts', (c,a,b) => admin.from('piesa_records').select('job_id, outcome, completed_date, section_c_signed_at').in('job_id',c).eq('is_current',true).order('id').range(a,b)),
    byJobs('electrical fixes quotes', (c,a,b) => admin.from('quotes').select('job_id, status, release_state, sent_at').in('job_id',c).eq('kind','rectification').in('status',['issued','accepted']).order('created_at').order('id').range(a,b)),
    byJobs('owner time windows', (c,a,b) => admin.from('ready_check_windows').select('job_id, status').in('job_id',c).eq('status','open').order('id').range(a,b)),
    byJobs('proposed appointments', (c,a,b) => admin.from('appointment_proposals').select('job_id, kind, created_at').in('job_id',c).eq('status','proposed').order('created_at').order('id').range(a,b)),
    (async () => {
      const originIds = [...new Set(jobs.map(j => text(j['originating_installer_business_id'])).filter((id): id is string => !!id))];
      const rows: Row[] = [];
      for (let i = 0; i < originIds.length; i += 150) rows.push(...await all('originating installers', (a,b) => admin.from('businesses').select('id,name').in('id',originIds.slice(i,i+150)).order('id').range(a,b)));
      return rows;
    })(),
  ]);
  if (cfg.error) throw new Error(`Automation settings could not load: ${cfg.error.message}`);
  if (delivery.error) throw new Error(`Delivery settings could not load: ${delivery.error.message}`);
  const grouped=(rows:Row[])=>{const m=new Map<string,Row[]>();for(const r of rows){const id=String(r['job_id']);m.set(id,[...(m.get(id)??[]),r]);}return m;};
  const maps=[campaigns,offers,bookings,readyChecks,measurements,requirements,sends,communications,media,reviews,verifications,quotes,payments,deadlines,stages,handoffs,assignments,outboxFailures,xeroFailures,smsUnknown,piesa,rectQuotes,windows,proposals].map(grouped);
  const mine=(n:number,id:string)=>maps[n]?.get(id)??[];
  const last=(n:number,id:string)=>mine(n,id).at(-1)??{};
  const inputs:OperationInput[]=jobs.map(j=>{
    const id=String(j['id']),stage=String(j['stage']),camp=last(0,id),rc=last(3,id),q=last(11,id),payment=last(12,id);
    const prop=related(j['properties']),base44=obj(obj(prop['enrichment'])['base44']);
    const insulation=normaliseInsulation(declaredExtras(obj(obj(base44['raw'])['answers'])).existing_insulation);
    const review=text(obj(last(9,id)['metadata'])['outcome']);
    const mediaReview=review==='below_r2'||review==='over_r2'||review==='unclear'?review:null;
    const v=last(10,id),stored=Object.keys(v).length?v as unknown as StoredVerification:null;
    const stale=verificationStale(stored,{ref:text(rc['id']),version:typeof rc['version']==='number'?rc['version']:null});
    const failures:string[]=[];
    for (const r of mine(17,id)) failures.push(`Failed ${String(r['action_type']).replace(/_/g,' ')}: ${text(r['last_error_code']) ?? 'error recorded'}`);
    for (const r of mine(18,id)) failures.push(`Invoice sync failed: ${text(r['last_sync_error'])}`);
    for (const r of mine(19,id)) failures.push(`SMS ${String(r['message_type']).replace(/_/g,' ')} ${String(r['status']).replace(/_/g,' ')} — office review before any resend`);
    if (j['channel']==='installer_sourced' && j['commercial_model']!=='hivic_invoices_owner') failures.push('Commercial setup required');
    if (j['offer_dispatch_override']==='office_picks') failures.push('Job offer automation paused — office picks');
    if(stale) failures.push('Recorded verified eligibility is out of date — newer or missing Ready Check');
    if(j['eligibility_review_required']) failures.push(text(j['eligibility_reason'])??'Recorded eligibility requires office review');
    if(j['eligibility_outcome']==='needs_onsite_confirmation'&&mediaReview!=='below_r2'&&mediaReview!=='over_r2'){
      const checked=insulationOnly(j['eligibility_decision_rules'] as StoredAudit,insulation);
      if(!checked.ok) failures.push(`Other eligibility checks need review: ${checked.why}`);
    }
    const at=(kind:string)=>text(mine(2,id).filter(b=>b['kind']===kind&&['confirmed','completed'].includes(String(b['status']))).at(-1)?.['scheduled_start']);
    const offered=(kind:string)=>text(mine(1,id).filter(o=>o['kind']===kind).at(-1)?.['offered_at']);
    const proof=[...mine(6,id).map(r=>({purpose:String(r['purpose']),status:String(r['status']),at:text(r['sent_at']),actionKey:text(r['idempotency_key']),recordedAt:text(r['created_at']),error:text(r['error']),order:String(r['created_at'])})),...mine(7,id).map(r=>({purpose:String(r['channel']),status:String(r['delivery_status']),at:text(r['sent_at']),recordedAt:text(r['created_at']),order:String(r['created_at'])}))].sort((a,b)=>a.order.localeCompare(b.order));
    return {id,jobNumber:String(j['job_number']),owner:text(related(j['owners'])['full_name']),address:formatPropertyAddress(prop)||null,source:text(j['source']),channel:text(j['channel']),businessUnit:text(j['business_unit']),
      originatingInstaller:text(origins.find(o=>o['id']===j['originating_installer_business_id'])?.['name'])??text(j['originating_installer_business_id']),
      assignedInstaller:mine(16,id).map(a=>text(related(a['businesses'])['name'])??`Assigned installer ${text(a['user_id'])??'(name unavailable)'}`).join(', ')||null,
      eligibility:text(j['eligibility_outcome']),eligibilityReason:text(j['eligibility_reason'])??text(j['hold_reason']),verifiedEligibility:stale?'stale':text(v['outcome']),insulation,insulationOnlyPassed:insulationOnly(j['eligibility_decision_rules'] as StoredAudit,insulation).ok,paymentDueAt:text(payment['deposit_due_date']),mediaCount:mine(8,id).length,mediaReview,
      actualHandoff:mine(15,id).length>0||mine(1,id).length>0||mine(2,id).length>0||!!rc['attended_at']||!!rc['submitted_at']||mine(4,id).some(m=>!!m['accepted_by']),
      evidence:mine(5,id).map(e=>({label:String(e['label']),status:String(e['status']),role:text(e['responsible_role']),gate:text(e['gate'])})),communications:proof,failures,
      facts:{id,stage,createdAt:String(j['created_at']),lastActivityAt:text(j['last_activity_at']),enteredStageAt:text(mine(14,id).filter(e=>e['to_stage']===stage).at(-1)?.['created_at']),holdRevisitAt:text(j['hold_revisit_at']),cancelledReason:text(j['cancelled_reason']),
        campaign:Object.keys(camp).length?{spotSavedAt:text(camp['spot_saved_at']),optedOutAt:text(camp['opted_out_at']),videoRequested:!!camp['video_requested'],mediaReceivedAt:text(camp['media_received_at']),deskCheckStatus:text(camp['desk_check_status']),queuePriority:text(camp['queue_priority']),createdAt:String(camp['created_at'])}:null,
        rcOfferAt:offered('ready_check'),rcBookingAt:at('ready_check'),rcSubmittedAt:text(rc['submitted_at']),rcAccepted:mine(15,id).length>0,
        quote:Object.keys(q).length?{status:String(q['status']),releaseState:text(q['release_state']),holdReason:text(q['release_hold_reason']),sentAt:text(q['sent_at']),acceptedAt:text(q['accepted_at'])}:null,
        paymentCleared:payment['deposit_cleared']===true,elecOfferAt:offered('piesa'),elecBookingAt:at('assessment'),rectBookingAt:at('rectification'),installBookingAt:at('installation'),installDeadline:text(last(13,id)['install_deadline']),installedAt:text(j['installation_completed_at']),evidenceMissing:mine(5,id).filter(e=>['outstanding','rejected'].includes(String(e['status']))).length,
        piesa: mine(20,id).length ? { completedAt:text(last(20,id)['completed_date']), passed:last(20,id)['outcome']==='pass', sectionCAt:text(last(20,id)['section_c_signed_at']) } : null,
        rectQuote: mine(21,id).length ? { status:String(last(21,id)['status']), releaseState:text(last(21,id)['release_state']), sentAt:text(last(21,id)['sent_at']) } : null,
        rcWindowsOpen: mine(22,id).length,
        proposalPending: mine(23,id).length ? { kind:String(last(23,id)['kind']), since:String(last(23,id)['created_at']) } : null,
      }};
  });
  const c=cfg.data;
  const control=(label:string,enabled:boolean|null|undefined,detail:string):AutomationControl=>({label,state:enabled==null?'Unknown':enabled?'Enabled':'Paused',detail});
  return buildOperationsPreview(inputs,[
    control('Customer messages',c?.customer_comms_enabled,'Global permission only; consent and sending rules still apply.'),
    control('Customer delivery adapter',delivery.data?.enabled,'Setting only; connection health not tested.'),
    control('Save my spot',c && delivery.data ? SAVE_SPOT_REAL_SEND_APPROVED && c.customer_comms_enabled && delivery.data.enabled : null,'Approved path; global controls, estimate, consent, coverage and duplicate guards still apply.'),
    {label:'Insulation-details email',state:c && delivery.data ? sendingControlState(INSULATION_DETAILS_REAL_SEND_APPROVED,c.customer_comms_enabled,delivery.data.enabled) : 'Unknown',detail:'Approved by Jo 9 Oct; still needs global customer messages permission and delivery adapter permission.'},
    control('Quotes',c?c.auto_send_quote&&c.customer_comms_enabled:null,'Requires release rules and customer messages permission.'),
    control('Mitti',c?.auto_send_mitti,'Setting only; forms and connection not tested.'),
    control('Installer offers',c?c.auto_send_installer&&!officePicks(c.offer_dispatch_mode,null):null,'Office-picks mode or disabled switch pauses automatic offers.'),
    control('Electrician offers',c?c.auto_send_rec&&!officePicks(c.offer_dispatch_mode,null):null,'Office-picks mode or disabled switch pauses automatic offers.'),
  ],Date.now());
}
