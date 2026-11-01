/** Isolated SIM integration harness. Actual server-module bodies run against a single memory DB.
 * Explicit prerequisite fixture steps are NOT end-to-end handler proof (see SIM report).
 * Every unknown dependency and all network access fail closed. No production client is imported.
 */
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as mail from '../../src/lib/mail-mjml.core';
import { expect } from 'bun:test';
import { memoryPostgrest, type Tables } from './memory-postgrest';
import * as time from '../../src/lib/melbourne-time.core';
import * as bookingCore from '../../src/lib/in-house-booking.core';
import * as compliance from '../../src/lib/worker-compliance.core';
import * as allocation from '../../src/lib/visit-allocation.core';
import * as clearance from '../../src/lib/allocation.core';
import * as days from '../../src/lib/install-days.core';
import * as workflowCore from '../../src/lib/workflow';
import * as paymentCore from '../../src/lib/payments.core';
import * as paymentGate from '../../src/lib/payment-gate.core';
import * as esc from '../../src/lib/esc.core';
import * as claims from '../../src/lib/mitti-create-claim.core';
import * as workerRole from '../../src/lib/worker-role.core';
import * as crewCore from '../../src/lib/piisa-a3.core';
import * as swms from '../../src/lib/swms.core';
import * as layouts from '../../src/lib/partner-email.core';
import * as windowCore from '../../src/lib/thirty-day-rule.core';
import * as repeat from '../../src/lib/repeat-piesa.core';
import * as depositCore from '../../src/lib/deposit-request.core';
import * as depositEmail from '../../src/lib/deposit-request-email.core';
import * as address from '../../src/lib/address';
import * as quiet from '../../src/lib/quote-hold.core';
import { practiceHandback } from './sim-handback-practice';
import * as tradeCore from '../../src/lib/trade-view.core';
import * as needs from '../../src/lib/office-needs.core';
import * as confirmation from '../../src/lib/piesa-owner-confirm.core';
import * as shortForm from '../../src/lib/official-short.core';
import * as mittiCore from '../../src/lib/mitti.core';
import * as deliveryCore from '../../src/lib/piesa-delivery.core';
import * as estimateCore from '../../src/lib/estimatelink.core';
import { mittiApi } from '../../src/lib/mitti.core';

export class MelbourneSimClock {
  private instant = new Date('2026-11-01T22:00:00Z');
  set(iso:string){const next=new Date(iso);if(!Number.isFinite(next.getTime()))throw Error('Invalid SIM clock');this.instant=next;}
  now(){return new Date(this.instant);}
  iso(){return this.instant.toISOString();}
  day(){return time.melbourneToday(this.now());}
  hour(){return Number(new Intl.DateTimeFormat('en-AU',{timeZone:'Australia/Melbourne',hour:'numeric',hour12:false}).format(this.now()))%24;}
  dateConstructor(){const clock=this;return class extends Date {constructor(value?:string|number){super(value??clock.now().getTime());}static now(){return clock.now().getTime();}};}
}
export type Captured={who:string;channel:'email'|'sms';template:string;to:string;key:string;body:string;subject?:string;attachments?:unknown[]};
function load(path:string,deps:Record<string,any>,clock:MelbourneSimClock){
 const api:any={};const js=ts.transpile(readFileSync(path,'utf8'),{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022});
 new Function('exports','require','Date','fetch',js)(api,(p:string)=>{if(!(p in deps))throw Error(`SIM unmocked dependency ${p} in ${path}`);return deps[p];},clock.dateConstructor(),()=>{throw Error('Network prohibited in SIM');});return api;
}
export function createInHouseSim(){
 const clock=new MelbourneSimClock(),messages:Captured[]=[],keys=new Set<string>();let cursor=0;
 const job:any={id:'job',job_number:'HV-SIM',source:'base44',stage:'ready_check_ready_to_schedule',owner_id:'owner',property_id:'property',deleted_at:null};
 const tables:Tables={jobs:[job],owners:[{id:'owner',full_name:'Practice Owner',email:'owner@example.invalid',phone:'0400000001'}],properties:[{id:'property',address_line:'1 Practice St',suburb:'Melbourne',postcode:'3000',year_built:1995}],businesses:[{id:'biz',name:'Practice Insulation',email:'office@example.invalid',phone:'0399999999',in_house:true,mitti:false,business_type:'eec_installer',capabilities:['installer'],onboarding_status:'approved',is_active:true}],profiles:[{id:'installer-office',email:'office@example.invalid',full_name:'Practice Office'},{id:'electrician',email:'electrician@example.invalid',full_name:'Practice Electrician'},{id:'lead',email:'lead@example.invalid',full_name:'Practice Lead Installer'},{id:'replacement',email:'replacement@example.invalid',full_name:'Replacement Lead Installer'}],business_members:[{business_id:'biz',user_id:'installer-office',active:true,member_role:'business_admin'}],partner_workers:[],job_assignments:[{id:'installer-assignment',job_id:'job',business_id:'biz',user_id:'installer-office',role:'installer',active:true}],bookings:[],workflow_events:[],ceiling_measurements:[],assessments:[],customer_email_sends:[]};
 for(const id of ['lead','replacement','crew','electrician'])tables.partner_workers.push({id,profile_id:id,business_id:'biz',full_legal_name:id==='lead'?'Practice Lead Installer':id==='replacement'?'Replacement Lead Installer':id,email:`${id}@example.invalid`,mobile:'0400000002',trade_role:id==='electrician'?'electrician':'installer',worker_role:id==='crew'?'crew':'lead',approval_status:'approved',removed_at:null,licence_number:'A123',rec_number:'REC123',licence_expires_on:'2027-12-31',licence_verified_at:clock.iso(),esc_registered:id!=='crew',esc_registered_at:clock.iso()});
 const raw=memoryPostgrest(tables);const db:any={from:(name:string)=>{const q=raw.from(name);const insert=q.insert;q.insert=(p:any)=>insert((Array.isArray(p)?p:[p]).map((r:any)=>({created_at:clock.iso(),...r})));const eq=q.eq;q.eq=(column:string,value:unknown)=>column==='details'&&typeof value==='string'?q.contains(column,JSON.parse(value)):eq(column,value);return q;}};
 const emit=(who:string,channel:'email'|'sms',template:string,to:string,key:string,body:string,subject?:string)=>{if(keys.has(key))return;keys.add(key);if(who==='installer-office'&&channel!=='email')throw Error('Installer office SMS prohibited');messages.push({who,channel,template,to,key,body,subject});};
 const who=(to:string)=>to==='owner@example.invalid'||to==='0400000001'?'owner':to==='office@example.invalid'?'installer-office':to==='info@homeinsulationvictoria.com.au'?'hiv-office':to.split('@')[0];
 const logEvent=async(id:string,actor:string|null,type:string,summary:string,details:any={},_opts?:any)=>{tables.workflow_events.push({id:`event-${tables.workflow_events.length}`,job_id:id,actor_id:actor,event_type:type,summary,details,created_at:clock.iso()});};
 const formMap=new Map<string,{id:string;owner:string;done:boolean;date:string|null;access:Set<string>}>();
 const event=(type:string,details:any)=>{tables.workflow_events.push({id:`event-${tables.workflow_events.length}`,job_id:'job',event_type:type,details,created_at:clock.iso()});};
 const currentSelection=()=>tables.workflow_events.filter(e=>e.event_type==='piisa_crew_selected').at(-1)?.details.selection??{lead:null,additional:[]};
 const staff=()=>tables.partner_workers.map(w=>({workerId:w.id,name:w.full_legal_name,eec:'CII-'+w.id,eecVerified:true,cleared:true,workerRole:w.worker_role,level:'full',expiresOn:'2027-12-31',whiteCard:'verified'}));
 const loadCrew=async()=>({selection:currentSelection(),staff:staff()});
 const form=(id:string,owner:string)=>{if(!formMap.has(id))formMap.set(id,{id,owner,done:false,date:null,access:new Set([owner])});};
 const mittiCall=async(method:string,path:string)=>{if(method==='DELETE'){const match=/\/inspections\/v1\/inspections\/([^/]+)\/user\/([^/]+)\/access/.exec(path);if(!match)throw Error(`Unsupported SIM Mitti ${path}`);formMap.get(match[1])?.access.delete(decodeURIComponent(match[2]));}return {};};
 const mitti={realMittiCall:mittiCall,mittiCallFor:async()=>mittiCall,findMittiUserByEmail:async(email:string)=>email,createAssignMittiAudit:async(_j:string,_a:string,_c:any,o:any)=>{const id=o.readyCheck?'RC':'A3';form(id,o.assignee?.email??'office@example.invalid');if(id==='RC')tables.ceiling_measurements.push({job_id:'job',is_current:true,external_source:'mitti',external_id:id,status:'draft'});else tables.assessments.push({job_id:'job',external_mitti_id:id,status:'draft'});return{auditId:id};},createPiisaMittiAudit:async(_j:string,_a:string,_c:any,o:any)=>{form('A5',o.assignee.email);event('mitti_piisa_audit_created',{audit_id:'A5'});return{auditId:'A5'};},reassignMittiFormTo:async(p:any)=>{const f=formMap.get(p.auditId);if(!f)throw Error('SIM form missing');f.owner=p.email;f.access.add(p.email);},updateMittiInstallCrew:async()=>{}};
 const fixes={existingRectificationForm:async()=>formMap.has('A4')?{auditId:'A4',closed:closedForms().includes('A4'),round:'A3'}:null,createFixesForm:async()=>{form('A4','office@example.invalid');event('fixes_form_created',{audit_id:'A4',rectification_round:'A3'});return{status:'created',auditId:'A4'};},onRectificationBooked:async()=>{}};
 const held=async(ids:string[])=>({failed:false,held:new Set(ids.filter(id=>tables.job_assignments.some(a=>a.job_id===id&&a.role==='installer'&&a.active)))});
 let signed=false,safetyPaid=false,depositPaid=false,piesaConfirmed=false,complete=false,upgrades=false,fixed=false;
 const deadline='2026-12-02';
 const paymentView=async()=>({invoiceId:'invoice',invoices:{install:{id:'invoice',xero_invoice_id:'xero-invoice'}},plan:{installDepositCents:36510},steps:[{key:'install_deposit',state:depositPaid?'paid':'due',outstandingCents:depositPaid?0:36510}],bank:{configured:true,accountName:'Practice',bsb:'123456',accountNumber:'12345678'},reference:'SIM-invoice',stripe:{available:true}});
 const context=async()=>({deadline,booked:tables.bookings.some(b=>b.kind==='installation'&&b.status==='confirmed'),expired:clock.day()>deadline,clearance:{cleared:complete&&(!upgrades||fixed),basis:fixed?'section_c':'initial_piesa',timingDate:'2026-11-02'}});
 const gates={WorkflowError:Error,logEvent,getStage:async()=>job.stage,transition:async(_j:string,target:string,actor:string,summary:string,details:any)=>{job.stage=target;await logEvent('job',actor,'stage_changed',summary,details);},commercialBlocker:async()=>null,paymentGate:async()=>safetyPaid?{cleared:true,option:'safety_check_paid'}:{cleared:false,blocker:'Pay $349'},piesaStatus:async()=>({install_deadline:deadline,piesa_expired:clock.day()>deadline}),piesaRequestFacts:async()=>({readyCheckComplete:tables.ceiling_measurements[0]?.status==='complete',verifiedEligible:true,currentQuoteApproved:signed,payment:await gates.paymentGate()}),stageEntryBlockers:async()=>[],READY_CHECK_BOOKING_RECORD_BLOCKER:'record'};
 const deps:Record<string,any>={
 '@/integrations/supabase/client.server':{supabaseAdmin:db},'./workflow.server':gates,'./workflow':workflowCore,'./in-house-booking.core':bookingCore,'./mitti-create-claim.core':claims,'./in-house-suppression.server':{readInHouseDispatchState:held},'./visit-allocation.core':allocation,'./worker-role.core':workerRole,'./worker-compliance.core':{...compliance,melbourneToday:()=>clock.day()},'./allocation.core':clearance,'./install-days.core':days,'./payment-gate.core':paymentGate,'./esc.core':esc,'./piisa-a3.core':crewCore,'./piisa-a3.server':{loadCrew,crewStaff:async()=>staff(),saveCrewSelection:async(_j:string,_a:string,selection:any)=>{event('piisa_crew_selected',{selection});return{ok:true};}},'./mitti.core':mittiCore,'./mitti.server':mitti,'./fixes-day.server':fixes,'./partner-email.core':layouts,'./melbourne-time.core':time,'./thirty-day-rule.core':windowCore,'./deposit-request.core':depositCore,'./deposit-request-email.core':depositEmail,'./payments.core':paymentCore,'./address':address,'./quote-hold.core':quiet,
 './trade-view.server':{requireTradeJob:async(user:string,id:string)=>{if(user!=='installer-office'||id!=='job'||!actorCanRead(user))throw Error('Not your job');return{boss:true,kind:'installer',biz:tables.businesses[0]};}},
 './visit-allocation.server':{allocationCandidates:async()=>tables.partner_workers.map(w=>({workerId:w.id,name:w.full_legal_name,mobile:w.mobile,tradeRole:w.trade_role,workerRole:w.worker_role,declarationsDue:false,clearance:{certStatus:'verified',level:'full',expiresOn:'2027-12-31'}})),allocateVisit:async(_j:string,_a:string,kind:string,id:string)=>event('visit_allocated',{visit:kind,worker_id:id,mitti_user_id:`${id}@example.invalid`}),saveCrewWithLead:async(_j:string,_a:string,selection:any)=>event('piisa_crew_selected',{selection})},
 './payments.server':{jobPaymentView:paymentView,installDepositBlockerFor:async()=>depositPaid?null:paymentCore.INSTALL_DEPOSIT_BLOCKER,fixesPaymentBlockerFor:async()=>null},'./install-days.server':{installDayContext:context},'./veec-copy-email.server':{ownerMyJobLink:async()=> 'https://example.invalid/my-job/SIM'},'./comms.server':{assertCustomerDeliveryAllowed:async()=>{}},'./trade-pause.server':{tradeMessagesPausedNow:async()=>null},'./qa-inbox.server':{qaDeliveryHeld:async()=>false},'./test-send.core':{isTestPartner:()=>false},'./set-password-link.core':{SET_PASSWORD_BASE:'https://example.invalid'},'./worker-links.core':{firstName:(s:string)=>s?.split(' ')[0]??'',hashToken:async(s:string)=>createHash('sha256').update(s).digest('hex')},'./piesa-owner-confirm.core':confirmation,'./official-short.core':shortForm,'./official-forms.server':{currentCopy:async()=>({copy:{id:'piesa-copy',signatureDate:'2026-11-02'}})},
 './owner-email-send.server':{sendGuardedOwnerEmail:async(p:any)=>{if(p.beforeSend)await p.beforeSend();const mail=p.build(null);emit(who(p.to),'email',p.purpose,p.to,p.key,mail.text,mail.subject);const captured=messages.find(m=>m.key===p.key);if(captured&&mail.attachments)captured.attachments=mail.attachments;return'sent';}},
 './sms.server':{sendRealSms:async(p:any)=>{emit(who(p.to),'sms',p.type,p.to,p.idempotencyKey,p.body);return{status:'sent'};}},
 './office-email.server':{sendOfficeEmail:async(p:any)=>{emit(who(p.to),'email',p.label,p.to,p.idempotencyKey??p.label,p.text,p.subject);return{status:'sent',detail:'captured'};}},
 './in-house-office-alert.server':{sendInHouseOfficeAlert:async(p:any)=>{emit(who(p.to),'email',p.idempotencyKey.startsWith('in-house-owner-cancelled:')?'in_house_owner_cancelled':p.idempotencyKey,p.to,p.idempotencyKey,p.text,p.subject);return{status:'sent'};}},
 './test-send.server':{sendTestEmail:async(c:any,to:string,subject:string,_html:string,text:string)=>{emit(who(to),'email',c.label,to,c.label,text,subject);return{status:'sent'};},sendTestSms:async(c:any,to:string,text:string)=>{emit(who(to),'sms',c.label,to,c.label+':sms',text);return{status:'sent'};}},
 './mitti-create.server':{readyCheckFormFacts:async()=>({booked:tables.bookings.some(b=>b.kind==='ready_check'&&b.status==='confirmed'),mittiInvited:true,autoSend:true,templateSet:true})},'./mitti-immediate.core':{bookedSkipReason:()=>null},'./mitti-pickup.server':{updateMittiFormDate:async(_j:string,start:string,_a:string,_c:any,o:any)=>{const f=formMap.get(o?.auditId??'RC');if(f)f.date=start;return{updated:true};}},
 './piesa-owner-confirm.server':{ownerPiesaConfirmationBlockerFor:async()=>piesaConfirmed?null:'Owner must confirm safety check'},'./allocation.server':{clearanceFacts:async()=>({piesaOutcome:upgrades?'fail':'pass',piesaCompletedAt:complete?'2026-11-02T22:00:00Z':null,rectificationRequired:upgrades,rectificationQuoteAccepted:fixed,rectificationCompletedAt:fixed?'2026-11-03T22:00:00Z':null,sectionCSignedAt:fixed?'2026-11-03T22:00:00Z':null})},
 './invoice-dates.server':{setInstallDueDate:async()=>{}},'./autoadvance.server':{autoAdvanceJob:async()=>{}},'./job-live.server':{jobDeletedBlocker:async()=>null},'./pilot.server':{requireApprovedPartner:async()=>{}},'./esc.server':{regenerateEscNotification:async()=>{}},'./install-attendance.server':{onInstallBooked:async()=>{}},'./owner-email-triggers.server':{onSafetyCheckBooked:async()=>{},onInstallBookingRescheduled:async()=>{}},'./piesa-autoform.server':{onPiesaBooked:async()=>{}},'./install-holds.server':{moveHoldForPiesa:async()=>{},moveHoldForRectification:async()=>{}},'./installer-planning-notice.server':{notifyInstallerPlanning:async()=>{}},'./engagement.server':{recordBookingCompleted:async()=>{}},'./consent.server':{syncOwnerConsent:async()=>{}},
 './swms.server':{loadSwms:async()=>swms.buildSwms({jobNumber:'HV-SIM',address:'1 Practice St',businessName:'Practice',installDate:'2026-11-16',lead:{name:currentSelection().lead,workerId:currentSelection().lead},crew:[{name:'crew',workerId:'crew'}],yearBuilt:1995,hazardNote:null,siteNote:null})},'./swms-sign-text.server':{textSwmsSignLinks:async()=>{}},
 'node:crypto':{createHash},'./early-read':{early:(p:any)=>Promise.resolve(p)},'./swms.core':swms,'./install-evidence.server':{melbourneDateOf:(iso:string)=>iso?time.melbourneToday(new Date(iso)):null},'./swms-house.core':{swmsHouseFacts:()=>({}),swmsHouseLines:()=>[],swmsHouseSteps:()=>[]},'./schema-compat.core':{isMissingDbObject:()=>false},'./mail-mjml.core':mail,'./repeat-piesa.core':repeat,'./payment-ledger.server':{PAYMENT_EVENT:'payment_recorded'},'./piesa-delivery.core':deliveryCore,'./estimatelink.core':estimateCore,'./engagement.core':{CUSTOMER_BASE:'https://example.invalid'},'./official-piesa-pdf.server':{officialPiesaPdf:async()=>({copyId:'piesa-copy',bytes:new Uint8Array([1,2])}),pdfAttachment:()=>({filename:'PIESA.pdf',content:'AQI=',contentType:'application/pdf'})},
 './xero.server':{createRepeatInvoice:async()=>{tables.invoices??=[];if(!tables.invoices.some(i=>i.id==='repeat-invoice'))tables.invoices.push({id:'repeat-invoice',job_id:'job',kind:'repeat_safety_check',repeat_key:deadline,total_inc_gst:349});return{};}},
 './name-address-tidy.core':{},'./office-jobs.core':{},'./job-disposition.server':{applyHoldOrCancel:async()=>{job.stage='cancelled';}},'./installer-run.server':{runOwnerCancelled:async(_id:string,o:any)=>{if(!o.silent)throw Error('Unexpected installer notice');return{told:false};}},'./cancel-notice.server':{sendCancelNotices:async()=>{throw Error('Unexpected owner/installer notice');}},
 };
 const forms=load('src/lib/in-house-forms.server.ts',deps,clock);deps['./in-house-forms.server']=forms;
 db.rpc=async(name:string,p:any)=>{
  if(name==='claim_in_house_saved_work'){const e=tables.workflow_events.find(e=>e.id===p._id);if(!e||['done','running'].includes(e.details.status))return{data:false,error:null};e.details={...e.details,status:'running',lease:p._lease};return{data:true,error:null};}
  if(name!=='allocate_team_electrician')throw Error(`SIM unmocked RPC ${name}`);tables.job_assignments=tables.job_assignments.filter(a=>a.role!=='electrician');tables.job_assignments.push({id:'electrician-assignment',job_id:'job',user_id:p._worker,business_id:'biz',role:'electrician',active:true});return{data:{ok:true},error:null};};
 const electrician=load('src/lib/in-house-electrician.server.ts',deps,clock);deps['./in-house-electrician.server']=electrician;
 const electricianBooked=load('src/lib/in-house-electrician-booked.server.ts',deps,clock);deps['./in-house-electrician-booked.server']=electricianBooked;
 const booking=load('src/lib/in-house-booking.server.ts',deps,clock);deps['./in-house-booking.server']=booking;
 const canonicalBook=load('src/lib/booking.server.ts',deps,clock);
 const deposits=load('src/lib/deposit-request.server.ts',deps,clock);
 const notices=load('src/lib/in-house-booking-notices.server.ts',deps,clock);
 const windows=load('src/lib/thirty-day-rule.server.ts',deps,clock);
 const cancelApi=load('src/lib/office-actions.server.ts',deps,clock);
 const safety=load('src/lib/swms.server.ts',deps,clock);deps['./swms.server']=safety;
 const savedWork=load('src/lib/in-house-saved-work.server.ts',deps,clock);deps['./in-house-saved-work.server']=savedWork;
 // SQL atomicity is PGlite-proven separately. SIM models its committed crew +
 // notice + durable work, then drives the real retry runner for Mitti/SWMS.
 deps['./in-house-atomic-save.server']={saveInHouseVisit:async(_job:string,_actor:string,input:any)=>{
  const old=currentSelection().lead;event('piisa_crew_selected',{selection:input.selection});
  const book=tables.bookings.find(b=>b.kind==='installation'&&b.status==='confirmed');
  if(book&&old&&old!==input.workerId){const name=tables.partner_workers.find(w=>w.id===input.workerId)?.full_legal_name;await logEvent('job','installer-office','in_house_lead_changed',`Update the ESC install notice: Lead Installer changed to ${name}`,{start:book.scheduled_start,worker_id:input.workerId,name,old_worker_id:old,booking_id:book.id});}
  const id=await savedWork.recordInHouseSavedWork('job','installer-office',{type:'crew',bookingId:book?.id??null,workerId:input.workerId,oldWorkerId:old},clock.iso()+input.workerId);
  await savedWork.runInHouseSavedWork(id,clock.now());return{needsVerification:[]};
 }};
 const visits=load('src/lib/visit-allocation.server.ts',deps,clock);deps['./visit-allocation.server']=visits;
 const disposition=load('src/lib/job-disposition.server.ts',deps,clock);deps['./job-disposition.server']=disposition;
 db.storage={from:()=>({download:async()=>({data:new Blob(['SIM certificate']),error:null})})};
 const coes=load('src/lib/coes-owner-copy.server.ts',deps,clock);
 const delivery=load('src/lib/piesa-delivery.server.ts',deps,clock);
 const repeatApi=load('src/lib/repeat-piesa.server.ts',deps,clock);
 const ownerConfirm=load('src/lib/piesa-owner-confirm.server.ts',deps,clock);deps['./piesa-owner-confirm.server']=ownerConfirm;
 deps['./allocation.server'].startPiesaAllocation=async()=>{event('repeat_offer_started',{deadline});return{};};
 function actorCanRead(actor:string){if(actor==='hiv-office'||actor==='owner')return true;if(actor==='installer-office')return tradeCore.tradeJobAllowed({signedIn:true,userId:actor,businessId:'biz',boss:true,jobId:'job',assignments:tables.job_assignments as any});if(actor==='electrician')return tradeCore.tradeJobAllowed({signedIn:true,userId:actor,businessId:'biz',boss:false,jobId:'job',assignments:tables.job_assignments as any});if(['lead','replacement','crew'].includes(actor))return tables.job_assignments.some(a=>a.role==='installer'&&a.active)&&(currentSelection().lead===actor||currentSelection().additional?.some((w:any)=>w.workerId===actor));return false;}
 function closedForms(){return tables.workflow_events.filter(e=>['in_house_form_closed_unused','rectification_form_closed_unused'].includes(e.event_type)).map(e=>e.details.audit_id);}
 async function book(kind:string,id:string,start:string){await booking.prepareBookingWorker('job','installer-office',kind,id,kind==='installation'?['crew']:[]);await canonicalBook.confirmBooking('job',kind,start,'installer-office','installer office');if(kind==='ready_check')await forms.ensureInHouseForms('job','installer-office');await booking.notifyOwnerBooked('job',kind==='assessment'?'piesa':kind==='installation'?'install':'ready_check',start,{id,name:tables.partner_workers.find(w=>w.id===id)?.full_legal_name,phone:'0400000002'},clock.now());}
 async function bookReadyCheck(replay=false){if(!replay)await book('ready_check','lead','2026-11-03T22:00:00Z');else await booking.notifyOwnerBooked('job','ready_check','2026-11-03T22:00:00Z',{id:'lead',name:'Practice Lead Installer',phone:'0400000002'},clock.now());}
 function completeReadyCheck(){tables.ceiling_measurements[0].status='complete';const f=formMap.get('RC');if(f)f.done=true;job.stage='quote_sent';}
 function acceptQuote(){signed=true;job.stage='awaiting_payment';}
 function paySafetyCheck(){safetyPaid=true;job.stage='piesa_and_install_window_pending';}
 async function bookSafetyCheck(){await book('assessment','electrician','2026-11-04T22:00:00Z');}
 async function completePiesa(needs:boolean){complete=true;upgrades=needs;tables.assessments[0].status='complete';tables.piesa_records=[{id:'current-piesa',job_id:'job',kind:'initial',is_current:true,outcome:needs?'fail':'pass',signed_off_by:'electrician',completed_date:'2026-11-02',created_at:clock.iso()}];tables.official_form_signed_copies=[{id:'piesa-copy',snapshot_sha256:'SIM-piesa'}];const f=formMap.get('A3');if(f)f.done=true;job.stage=needs?'rectification_scheduling':'installation_scheduling';if(!needs)await forms.closeUnneededForms('job','no_upgrades','electrician');await deposits.requestInstallDeposit('job',clock.now());}
 async function completeRectification(){fixed=true;event('fixes_form_completed',{audit_id:'A4'});const f=formMap.get('A4');if(f)f.done=true;job.stage='installation_scheduling';await deposits.requestInstallDeposit('job',clock.now());}
 async function payDeposit(source:string){depositPaid=true;event('install_deposit_received',{invoice_id:'invoice',source});await deposits.notifyInstallerDepositPaid('job',clock.now());}
 async function atClearance(){await bookReadyCheck();completeReadyCheck();acceptQuote();paySafetyCheck();await bookSafetyCheck();await completePiesa(false);}
 async function atInstallBooked(){await atClearance();await payDeposit('stripe');piesaConfirmed=true;await ownerConfirm.signOwnerPiesaConfirmation({jobId:'job',userId:null,codeId:null,fullName:'Practice Owner',signatureName:'Practice Owner',authority:'owner',confirmed:true,ip:null,userAgent:null});await book('installation','lead','2026-11-15T22:00:00Z');}
 return{clock,job,tables,messages,external:async(_url:string)=>{throw Error('Network prohibited');},actorCanRead,bookReadyCheck,completeReadyCheck,acceptQuote,paySafetyCheck,bookSafetyCheck,completePiesa,completeRectification,payDeposit,atClearance,atInstallBooked,confirmPiesa:async()=>ownerConfirm.signOwnerPiesaConfirmation({jobId:'job',userId:null,codeId:null,fullName:'Practice Owner',signatureName:'Practice Owner',authority:'owner',confirmed:true,ip:null,userAgent:null}),bookInstall:()=>book('installation','lead','2026-11-15T22:00:00Z'),tryDeposit:()=>deposits.requestInstallDeposit('job',clock.now()),sweepDeposits:()=>deposits.sweepDepositRequests(clock.now()),digest:()=>notices.sweepInHouseInstallOfficeEmails(clock.now()),
 readTeam:(actor:string)=>booking.bookingTeam('job',actor),
 installOffered:async()=>{const team=await booking.bookingTeam('job','installer-office');return team.depositPaid;},
 checkpoint:()=>{cursor=messages.length;},assertNoNewMessages:()=>{expect(messages.slice(cursor)).toEqual([]);},assertStep:(_label:string,stage:string,ids:string[],expected:string[][])=>{expect(job.stage).toBe(stage);expect([...formMap.keys()].sort()).toEqual([...ids].sort());expect(messages.slice(cursor).map(m=>[m.who,m.channel,m.template])).toEqual(expected);cursor=messages.length;expect(actorCanRead('other-office')).toBe(false);},assertOfficesEmailOnly:()=>{expect(messages.filter(m=>['installer-office','hiv-office'].includes(m.who)&&m.channel==='sms')).toEqual([]);},closedForms,
 cancel:async(reason:string)=>{await cancelApi.cancelJobFully('job',reason,'installer-office',{tell:{owner:false,installer:false},suppressRunNotice:true});await notices.notifyOfficeOwnerCancelled('job',reason,'installer-office');},
 swap:async(id:string)=>visits.saveCrewWithLead('job','installer-office',{lead:id,additional:[{workerId:'crew'}]},mittiCall),formOwner:(id:string)=>formMap.get(id)?.owner,formAccess:(id:string,email:string)=>formMap.get(id)?.access.has(email)??false,canSignSwms:async(actor:string)=>{const view=await safety.loadSwms('job');return swms.checkSwmsSign(view.plan,view.signatures,`w:${actor}`,tables.partner_workers.find(w=>w.id===actor)?.full_legal_name??actor).ok;},prestartBlocker:()=>booking.leadNoticeBlocker('job',clock.now()),ackEsc:()=>{const change=tables.workflow_events.filter(e=>e.event_type==='in_house_lead_changed').at(-1);event('in_house_esc_notice_updated',{change_id:change?.id});},
 windowWarnings:()=>windows.sendInstallWindowReminder('job',clock.day()<='2026-11-13'?'reminder_20':'reminder_10',deadline,clock.now()),tenDayFlag:()=>days.shouldFlagTenDaysLeft({deadline,booked:false,flaggedAt:null,now:clock.now()}),repeatDecision:()=>repeat.repeatPiesaState({lapsedDeadline:clock.day()>deadline?deadline:null,choice:null,acceptedAt:null,paidAt:null}),bookingOverdue:()=>bookingCore.bookingOverdue('2026-11-01T22:00:00Z',tables.bookings.some(b=>b.status==='confirmed'),clock.now()),
 handBack:async(reason:string,actor='installer-office')=>{const result=await practiceHandback(reason,actor==='installer-office');for(const a of tables.job_assignments)a.active=false;for(const e of result.events)event(e.event_type,e.details);},officeCandidates:()=>needs.needsCandidates({id:'job',jobNumber:'HV-SIM',surname:'Owner',suburb:'Melbourne',stage:job.stage,isTest:false,source:job.source,deletedAt:null,inHouse:{partnerName:'Practice Insulation',batchSentAt:'2026-11-01T22:00:00Z',readyCheckBooked:tables.bookings.some(b=>b.kind==='ready_check'&&b.status==='confirmed'),piesaCompleted:complete,quoteAcceptedAt:null,installationBooked:tables.bookings.some(b=>b.kind==='installation'&&b.status==='confirmed'),daysRemaining:complete?days.installDaysLeft(deadline,clock.now()):null,deadline},inHouseLeadChanged:tables.workflow_events.filter(e=>e.event_type==='in_house_lead_changed').at(-1)?{at:tables.workflow_events.filter(e=>e.event_type==='in_house_lead_changed').at(-1)?.created_at,line:tables.workflow_events.filter(e=>e.event_type==='in_house_lead_changed').at(-1)?.summary}:null,inHouseHandedBack:tables.workflow_events.some(e=>e.event_type==='in_house_pulled_back')?{at:clock.iso(),reason:tables.workflow_events.find(e=>e.event_type==='in_house_pulled_back')?.details.reason}:null} as any,clock.now().getTime()),
 handbackReason:()=>tables.workflow_events.filter(e=>e.event_type==='in_house_pulled_back').at(-1)?.details.reason,
 uploadCoes:async()=>{event('veu_factsheet_provided',{});tables.customer_agreements=[{job_id:'job',status:'signed'}];tables.piesa_records=[{id:'current-piesa',job_id:'job',is_current:true}];tables.piesa_deliveries=[{job_id:'job',piesa_record_id:'current-piesa',recipient:'owner'}];tables.job_compliance_records??=[];return coes.sendCoesOwnerCopy('job',{key:'certificate',files:[{storagePath:'job/certificate.pdf',mimeType:'application/pdf'}]});},
 deliverSafetyCopy:async()=>{tables.customer_estimate_links=[{job_id:'job',token:'SIM-token',purpose:'step3_estimate',status:'active',expires_at:'2028-01-01T00:00:00Z'}];return delivery.deliverPiesaCopies('job',clock.now());},
 repeatContext:async()=>(await repeatApi.repeatPiesaContext('job')).state,chooseRepeat:async()=>{tables.admin_config_events=[{event_type:'repeat_piesa_price_set',details:{price_inc_gst:349}}];return repeatApi.chooseRepeatPayer('job','owner','hiv-office');},acceptRepeat:()=>repeatApi.acceptRepeatPiesa('job'),payRepeat:(id:string,cents:number)=>repeatApi.repeatPaidFromInvoice('job',id,cents,'hiv-office'),
 };
}
