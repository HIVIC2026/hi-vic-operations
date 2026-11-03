import { beforeEach, expect, mock, test } from "bun:test";
type Row=Record<string,unknown>;
let ledger:Row[]=[], approved=false,optedOut=false,allowed=true;
const providerCalls:string[]=[];
function from(table:string){
  let one=false,head=false,op="read",payload:Row={};const filters:((r:Row)=>boolean)[]=[];
  const tables:Record<string,Row[]>={
    jobs:[{id:"j",source:"base44",deleted_at:null,stage:"preliminary_estimate_ready",owners:{email:"owner@example.com",full_name:"Sarah Smith",phone:null}}],
    workflow_events:[{job_id:"j","jobs.deleted_at":null,"jobs.source":"base44",event_type:"in_house_partner_call_email_pending",details:{business_id:"b",batch_id:"batch",partner_trading_name:"Rapid Insulation"}}],
    job_assignments:[{job_id:"j",business_id:"b",role:"installer",active:true}],
    bookings:[],
    customer_email_optouts:optedOut?[{job_id:"j",opted_out_at:"2026-10-30"}]:[],
    lead_campaign_responses:[],customer_engagement_events:[],
  };
  const run=()=>{
    if(table==="customer_email_sends" && op==="insert"){
      if(ledger.some(r=>r.idempotency_key===payload.idempotency_key))return {data:null,error:{message:"duplicate"}};
      const r={id:"s",status:"sending",...payload};ledger.push(r);return {data:one?r:[r],error:null};
    }
    const hits=(table==="customer_email_sends"?ledger:tables[table]??[]).filter(r=>filters.every(f=>f(r)));
    if(op==="update")hits.forEach(r=>Object.assign(r,payload));
    return {data:one?hits[0]??null:hits,error:null,...(head?{count:hits.length}:{})};
  };
  const q:any={select:(_s:unknown,o?:{head?:boolean})=>{head=!!o?.head;return q;},insert:(p:Row)=>{op="insert";payload=p;return q;},update:(p:Row)=>{op="update";payload=p;return q;},
    eq:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q;},neq:(k:string,v:unknown)=>{filters.push(r=>r[k]!==v);return q;},is:(k:string,v:unknown)=>{filters.push(r=>r[k]===v);return q;},
    in:(k:string,v:unknown[])=>{filters.push(r=>v.includes(r[k]));return q;},not:()=>q,order:()=>q,limit:()=>q,
    single:()=>{one=true;return q;},maybeSingle:()=>{one=true;return q;},then:(resolve:(x:unknown)=>unknown)=>Promise.resolve(run()).then(resolve)};return q;
}
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:{from}}));
mock.module("../src/lib/qa-inbox.server",()=>({qaDeliveryHeld:async()=>false,qaInboxRouteForJob:async()=>null}));
mock.module("../src/lib/emailsafety.server",()=>({unsubscribeUrlForJob:async()=>"https://example.com/u"}));
mock.module("../src/lib/comms.server",()=>({assertCustomerDeliveryAllowed:async()=>{if(!allowed)throw new Error("messages paused or consent absent");}}));
mock.module("../src/lib/hot-leads-send.server",()=>({resendSend:async(_to:string,_subject:string,_html:string,_text:string,key:string)=>{expect(ledger[0]?.status).toBe("sending");providerCalls.push(key);return {outcome:"accepted",id:"provider",detail:"accepted"};}}));
const mod=await import("../src/lib/in-house-batch-email.server");
// Decision #23: the wording comes from owner-will-call.core behind OWNER_WILL_CALL_APPROVED (injected here); the real
// guarded email sender, ledger and safeguards run unchanged.
const deps=()=>({approved,now:()=>new Date("2026-11-03T01:00:00Z"),contactFor:async()=>({name:"Rapid Insulation",tradingName:null,officePhone:"03 9000 0000",email:"office@rapid.example"}),
  sendSms:async()=>({status:"sent" as const,detail:"ok",sid:null}),logEvent:async()=>null});
const sendInHousePartnerCall=(id:string)=>mod.sendInHousePartnerCall(id,deps());
const sweepInHousePartnerCalls=()=>mod.sweepInHousePartnerCalls(deps());
beforeEach(()=>{ledger=[];approved=false;optedOut=false;allowed=true;providerCalls.length=0;});
test("approved wording uses real guarded ledger claim and sends once even concurrently",async()=>{
  approved=true;await Promise.all([sendInHousePartnerCall("j"),sendInHousePartnerCall("j")]);
  expect(ledger).toHaveLength(1);expect(ledger[0]).toMatchObject({purpose:"in_house_partner_call",status:"sent"});expect(providerCalls).toEqual(["in-house-partner-call:v1:j"]);
});
test("flag off creates no ledger; flag on then sweep sends once",async()=>{
  await sendInHousePartnerCall("j");await sweepInHousePartnerCalls();expect(ledger).toEqual([]);expect(providerCalls).toEqual([]);
  approved=true;await sweepInHousePartnerCalls();await sweepInHousePartnerCalls();expect(ledger).toHaveLength(1);expect(ledger[0]?.status).toBe("sent");expect(providerCalls).toHaveLength(1);
});
test("opt-out produces no ledger or provider call",async()=>{approved=true;optedOut=true;await sendInHousePartnerCall("j");await sweepInHousePartnerCalls();expect(ledger).toEqual([]);expect(providerCalls).toEqual([]);});
test("messages lock or absent consent produces no ledger",async()=>{approved=true;allowed=false;await sendInHousePartnerCall("j");expect(ledger).toEqual([]);expect(providerCalls).toEqual([]);});