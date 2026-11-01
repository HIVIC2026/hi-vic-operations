import {beforeEach,expect,mock,test} from 'bun:test';
import {memoryPostgrest,type Tables} from './helpers/memory-postgrest';
const tables:Tables={};const admin=memoryPostgrest(tables);
let requests=0,blockedTransition=false;
mock.module('@/integrations/supabase/client.server',()=>({supabaseAdmin:admin}));
mock.module('../src/lib/workflow.server',()=>({WorkflowError:Error,logEvent:async()=>{},stageEntryBlockers:async()=>[],getStage:async()=> 'piesa_scheduled',transition:async()=>{if(blockedTransition)throw Error('owner declaration required');}}));
mock.module('../src/lib/requirements.server',()=>({jobScope:async()=>({scope:'practice',label:'practice'}),advanceSiteRequirements:async()=>({advanced:false,scope:'practice'})}));
mock.module('../src/lib/autoadvance.server',()=>({autoAdvanceJob:async()=>{}}));
mock.module('../src/lib/piesa-rules-notice.server',()=>({piesaRulesBlockerFor:async()=>null}));
mock.module('../src/lib/official-piesa-issue.server',()=>({issueOfficialPiesa:async()=>{}}));
mock.module('../src/lib/in-house-forms.server',()=>({closeUnneededForms:async()=>0}));
mock.module('../src/lib/install-clearance.server',()=>({notifyInstallerClearance:async()=>{}}));
mock.module('../src/lib/deposit-request.server',()=>({requestInstallDeposit:async()=>{requests++;return 'mocked';}}));
mock.module('../src/lib/fixes-day.server',()=>({closeUnusedRectificationForm:async()=>{}}));
mock.module('../src/lib/rectification.server',()=>({rectificationWindowsExist:async()=>true}));
mock.module('../src/lib/in-house-rectification.server',()=>({optionalPartnerBilledRectificationFor:async()=>true}));
const {completePiesaAssessment}=await import('../src/lib/piesa-complete.server');
const {applyPiesaRecord}=await import('../src/lib/piesa-record.server');
beforeEach(()=>{
 for(const k of Object.keys(tables))delete tables[k];requests=0;blockedTransition=false;
 tables.assessments=[{id:'a',job_id:'j',status:'draft',piesa_outcome:'pass',assessed_on:'2026-10-31',switchboard_condition:'ok',rcds_present:true,life_support_confirmed:false,no_rectification_confirmed:true}];
 tables.piesa_records=[];tables.bookings=[];tables.workflow_events=[];tables.rectification_items=[];tables.evidence_requirements=[];tables.compliance_checks=[];
});
test('Complete PIESA pass calls the deposit request boundary',async()=>{
 await completePiesaAssessment({jobId:'j'},'electrician');expect(requests).toBe(1);
});
test('Complete PIESA with required rectification makes no deposit request',async()=>{
 const a=tables.assessments?.[0];if(a){a.piesa_outcome='fail';a.no_rectification_confirmed=false;}
 tables.rectification_items=[{id:'r',job_id:'j',status:'required',description:'Rectification',needs_office_pricing:false}];
 await completePiesaAssessment({jobId:'j'},'electrician');expect(requests).toBe(0);
});
test('recorded rectification completion requests deposit even if owner declaration holds scheduling',async()=>{
 blockedTransition=true;
 await expect(applyPiesaRecord({jobId:'j',actorId:'electrician',kind:'post_rectification',outcome:'pass',completedDate:'2026-10-31',sectionCSignedDate:'2026-10-31'})).rejects.toThrow('owner declaration required');
 expect(requests).toBe(1);expect(tables.piesa_records).toHaveLength(1);
});