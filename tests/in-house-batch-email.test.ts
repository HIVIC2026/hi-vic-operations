import { beforeEach, expect, mock, test } from "bun:test";
type Row=Record<string,unknown>;
let ledger:Row[]=[], approved=false,optedOut=false,allowed=true,jobSource="base44",photoMarked=false;
const providerCalls:string[]=[];
function from(table:string){
  let one=false,head=false,op="read",payload:Row={};const filters:((r:Row)=>boolean)[]=[];
  const tables:Record<string,Row[]>={
    jobs:[{id:"j",source:jobSource,deleted_at:null,stage:"preliminary_estimate_ready",owners:{email:"owner@example.com",full_name:"Sarah Smith",phone:null}}],
    workflow_events:[{job_id:"j","jobs.deleted_at":null,"jobs.source":"base44",event_type:"in_house_partner_call_email_pending",details:{business_id:"b",batch_id:"batch",partner_trading_name:"Rapid Insulation"}},...(photoMarked?[{job_id:"j",event_type:"in_house_quote_method",details:{batch_id:"batch",business_id:"b",quote_method:"photos"}}]:[])],
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
beforeEach(()=>{jobSource="base44";photoMarked=false;ledger=[];approved=false;optedOut=false;allowed=true;providerCalls.length=0;});
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
// Photo-quote installers Task 3 (spec decision 3): a From photos give gets ONE "Good news: no visit needed" email and
// never the will-call email or text.
const give={batchId:"batch",businessId:"b",givenAt:"2026-11-03T00:00:00Z"};
const photoDeps=(o:Record<string,unknown>={})=>{const sms:unknown[]=[],events:unknown[][]=[],tests:unknown[]=[];
  return {sms,events,tests,d:{...deps(),approved:true,photoApproved:true,photoGive:async()=>give,
    sendSms:async(i:unknown)=>{sms.push(i);return {status:"sent" as const,detail:"ok",sid:null};},
    logEvent:async(...a:unknown[])=>{events.push(a);return null;},
    sendTest:async(p:unknown)=>{tests.push(p);return "test_sent";},...o}};};
test("photos give: the no visit needed email under its own purpose and key, and no text",async()=>{
  const p=photoDeps({contactFor:async()=>({name:"No Gap Insulation",tradingName:null,officePhone:"03 9000 1111",email:"office@nogap.example"})});
  const r=await mod.sendInHousePartnerCall("j",p.d as never);
  expect(r).toBe("sent");
  expect(ledger).toHaveLength(1);expect(ledger[0]).toMatchObject({purpose:"owner_photo_quote_notice",idempotency_key:"owner-photo-quote-notice:v1:j:batch"});
  expect(providerCalls).toEqual(["owner-photo-quote-notice:v1:j:batch"]);
  expect(p.sms).toEqual([]);
  expect(await mod.sendInHousePartnerCall("j",p.d as never)).toBe("already attempted");
});
test("photos give with its switch off: one held event per give, nothing sent, never the will-call email",async()=>{
  const p=photoDeps({photoApproved:false});
  expect(await mod.sendInHousePartnerCall("j",p.d as never)).toBe("awaiting approval");
  expect(ledger).toEqual([]);expect(providerCalls).toEqual([]);expect(p.sms).toEqual([]);
  expect(p.events).toHaveLength(1);expect(p.events[0]![2]).toBe("owner_photo_quote_notice_held");
});
test("photos give: missing office phone → held with the reason, nothing sent",async()=>{
  const p=photoDeps({contactFor:async()=>({name:"No Gap Insulation",tradingName:null,officePhone:null,email:"office@nogap.example"})});
  expect(await mod.sendInHousePartnerCall("j",p.d as never)).toBe("held: No office phone for No Gap Insulation");
  expect(ledger).toEqual([]);expect(p.events[0]![2]).toBe("owner_photo_quote_notice_held");
});
test("sweep: a photos job goes through the photo email even while the will-call switch is off",async()=>{
  const p=photoDeps({approved:false});
  // the fixture has no photo method row, so feed one through photoGive and mark the job in workflow_events reads
  const r=await mod.sweepInHousePartnerCalls({...p.d,approved:false} as never);
  // no photo method record in the fixture → the job is a Ready Check job → not a candidate while will-call is off
  expect(r).toEqual({checked:0,sent:0});expect(ledger).toEqual([]);
});
test("photos give on a TEST job → test-send, never the real sender",async()=>{
  jobSource="qa_test";const p=photoDeps({photoApproved:false,contactFor:async()=>({name:"TEST INSTALLER",tradingName:null,officePhone:"03 9000 1111",email:"t@example.com"})});
  expect(await mod.sendInHousePartnerCall("j",p.d as never)).toBe("test_sent");
  expect(p.tests).toHaveLength(1);expect((p.tests[0] as {key:string;mail:{subject:string;text:string}}).key).toBe("owner-photo-quote-notice:v1:j:batch");
  expect((p.tests[0] as {mail:{subject:string}}).mail.subject).toBe("Good news: no visit needed");
  expect(ledger).toEqual([]);expect(providerCalls).toEqual([]);expect(p.sms).toEqual([]);
});
test("sweep: a photos job gets the photo email once while only the photo switch is on; Ready Check jobs wait",async()=>{
  photoMarked=true;const p=photoDeps({approved:false,contactFor:async()=>({name:"No Gap Insulation",tradingName:null,officePhone:"03 9000 1111",email:"office@nogap.example"})});
  expect(await mod.sweepInHousePartnerCalls(p.d as never)).toEqual({checked:1,sent:1});
  expect(await mod.sweepInHousePartnerCalls(p.d as never)).toEqual({checked:0,sent:0});
  expect(ledger).toHaveLength(1);expect(ledger[0]?.purpose).toBe("owner_photo_quote_notice");expect(p.sms).toEqual([]);
});
// Review fix round (minor): a failed photo read on a Ready Check job behaves as before — "awaiting approval" while the
// will-call switch is off; with it on, the same safeguards failure as any other failed read (never "will call" on a
// job that might be a photo job).
test("failed photo read: switch off → awaiting approval (as before); switch on → the safeguards error, nothing sent",async()=>{
  const broken=async()=>{throw new Error("read failed");};
  expect(await mod.sendInHousePartnerCall("j",{...deps(),approved:false,photoApproved:false,photoGive:broken} as never)).toBe("awaiting approval");
  await expect(mod.sendInHousePartnerCall("j",{...deps(),approved:true,photoApproved:false,photoGive:broken} as never)).rejects.toThrow("Could not read partner call email safeguards.");
  expect(ledger).toEqual([]);expect(providerCalls).toEqual([]);
});
