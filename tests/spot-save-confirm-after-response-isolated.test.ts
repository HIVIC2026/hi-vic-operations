import { test, expect, mock } from 'bun:test';

const token = 'a'.repeat(64);
const events: string[] = ['campaign_spot_saved'];
let stage = 'preliminary_estimate_ready', commits = 0, confirmations = 0, sends = 0;
let release: () => void = () => {}; const gate = new Promise<void>(r => { release = r; });
const saved = { spot_saved_at: '2026-10-22T00:00:00Z', estimate_link_id: 'link', desk_check_status: 'not_needed', opted_out_at: null };
const job = { id: 'job', source: 'base44', eligibility_outcome: 'likely_eligible', eligibility_review_required: false,
  properties: { enrichment: { base44: { raw: { answers: { existing_insulation: 'none' } } } } } };
mock.module('../src/integrations/supabase/client.server',()=>({supabaseAdmin:{
  from(table:string) {
    let eventType='';
    const result=()=>({data:table==='customer_estimate_links'?{id:'link',job_id:'job',status:'active',expires_at:'2099-01-01'}:
      table==='jobs'?{...job,stage}:table==='lead_campaign_responses'?saved:
      table==='owner_contact_consents'?{consent_status:'granted'}:
      table==='workflow_events'?(events.includes(eventType)?{id:'event'}:null):
      table==='customer_engagement_events'?[]:null,error:null});
    const q:any={select:()=>q,eq:(key:string,value:string)=>{if(key==='event_type')eventType=value;return q;},
      order:()=>q,limit:()=>q,maybeSingle:async()=>result(),insert:()=>q,
      then:(resolve:any,reject:any)=>Promise.resolve(result()).then(resolve,reject)};
    return q;
  },
  async rpc(name:string) { expect(name).toBe('save_campaign_spot_atomic'); commits++;stage='ready_check_ready_to_schedule';return {data:false,error:null}; },
}}));
mock.module('../src/lib/workflow.server',()=>({logEvent:async(_j:string,_a:unknown,event:string)=>{events.push(event);}}));
mock.module('../src/lib/spot-saved-send.server',()=>({
  buildSpotSavedMessages:async()=>({job:{source:'base44'},owner:{email:null,phone:null},email:{subject:'',text:''},sms:''}),
  sendSpotSavedConfirmation:async()=>{await gate;confirmations++;return {email:{status:'already',detail:'recorded'},sms:{status:'already',detail:'recorded'}};},
}));
mock.module('../src/lib/sms.server',()=>({sendRealSms:async()=>{sends++;throw Error('No sends allowed');}}));
mock.module('../src/lib/hot-leads-send.server',()=>({resendSend:async()=>{sends++;throw Error('No sends allowed');}}));
const { saveCampaignSpot } = await import('../src/lib/launch-campaign.server');
test('save answers before the confirmation finishes; confirmation still runs exactly once',async()=>{
  expect(await saveCampaignSpot(token)).toEqual({ok:true});
  expect(commits).toBe(1);expect(confirmations).toBe(0);
  release();await new Promise(r=>setTimeout(r,20));
  expect(confirmations).toBe(1);
  expect(await saveCampaignSpot(token)).toEqual({ok:true});await new Promise(r=>setTimeout(r,20));
  expect(confirmations).toBe(1);expect(sends).toBe(0);
});
