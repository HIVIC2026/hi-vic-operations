// Exercise the actual office follow-up sender without external delivery or hosted data.
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { REMOVAL_BUDGET_EMAIL_NOTE } from "../src/lib/estimate-removal.core";
let qualified = true, enabled = false, reviewed = true;
let originalMediaReads = 0, writes = 0, networkCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => { networkCalls++; throw new Error("Unexpected network request in isolated follow-up tests"); }) as typeof fetch;
afterAll(() => { globalThis.fetch = originalFetch; expect(networkCalls).toBe(0); });
const token = "A".repeat(43), id = "00000000-0000-4000-8000-000000000001";
const data: Record<string, unknown> = {
  jobs: {id,job_number:"HV-TEST",source:"base44",stage:"preliminary_estimate_ready",estimated_area_m2:150,estimated_area_unknown:false,eligibility_outcome:"needs_onsite_confirmation",owners:{full_name:"TEST Owner",email:"test@example.test"},properties:{address_line:"TEST",suburb:"TEST",postcode:"3000"}},
  customer_estimate_links: {id,token,status:"active",expires_at:new Date(Date.now()+86_400_000).toISOString()}, indicative_estimates: {id,area_m2:150,area_source:"owner_estimate",insulation_declared:"present",scenarios:[{removal:0,removal_m2:0,by_access:{standard:{estimated_customer_total:2000,applied_discount:3198,pre_discount_total:5198}}}],snapshot:{settings:{piesa_assessment_inc_gst:349,ap_management_inc_gst:349},scenarios:[{by_access:{standard:{installation:4500}}}]}},
  retail_estimator_settings:{indicative_veec_value:70},
};
mock.module("@/integrations/supabase/client.server", () => ({supabaseAdmin:{from(table: string) {
  const q = {select(){return q;},eq(){return q;},order(){return q;},limit(){const r={data:Array.isArray(data[table])?data[table]:[],error:null};return Object.assign(Promise.resolve(r),{maybeSingle:async()=>({data:data[table]??null,error:null})});} /* latest media review read (decision 392) */,maybeSingle:async()=>({data:data[table]??null,error:null}),insert(){writes++;return q;},update(){writes++;return q;},single:async()=>({data:{id},error:null})};return q;
}}}));
mock.module("../src/lib/launch-campaign.server",()=>({campaignLink:async()=>qualified?{group:"onsite",criteriaPassed:true,ownerQualified:!reviewed,mediaReview:reviewed?"below_r2":null,job:{id}}:null,campaignPermission:()=>qualified}));
mock.module("../src/lib/group-b-media.server",()=>({groupBMediaForJob:async()=>{originalMediaReads++;throw new Error("Invitation exclusion must not gate qualified follow-up");}}));
mock.module("../src/lib/comms.server",()=>({hasCurrentOwnerContactConsent:async()=>true,customerCommsEnabled:async()=>enabled}));
const realEstimate = await import("../src/lib/estimate.core");
mock.module("../src/lib/estimate.core",()=>({...realEstimate,discountIsWholeVeecs:()=>true}));
mock.module("../src/lib/emailsafety.server",()=>({unsubscribeUrlForJob:async()=>"https://estimate.homeinsulationvictoria.com.au/api/public/unsubscribe?t="+"A".repeat(43)}));
mock.module("../src/lib/referral.server",()=>({referralUrlForJob:async()=>null}));
mock.module("../src/lib/workflow.server",()=>({logEvent:async()=>{}}));
const {sendExistingInsulationSaveSpot} = await import("../src/lib/hot-leads-send.server");
beforeEach(()=>{
  qualified=true;enabled=false;reviewed=true;writes=0;originalMediaReads=0;delete data.customer_email_sends;
  Object.assign(data.customer_estimate_links as Record<string, unknown>, {status:"active",expires_at:new Date(Date.now()+86_400_000).toISOString()});
  Object.assign(data.jobs as Record<string, unknown>, {estimated_area_m2:150,estimated_area_unknown:false});
});
// P1-S77 + decision 67 (Jo 24 Oct): the reviewed below-R2 follow-up renders the approved "some insulation" Save my spot
// (docs/templates/mjml/owner_O2-some.mjml) — "you may qualify for $X off" heading and the
// "Your existing insulation" card with the $15/m² removal line. No separate follow-up copy.
test("office below-R2 preview renders the approved some-insulation Save my spot despite original media",async()=>{
  const r = await sendExistingInsulationSaveSpot(id,id,true);
  expect(r.preview?.subject).toBe("TEST, your insulation looks eligible—save your spot");
  expect(r.preview?.plainText).toContain("TEST, you may qualify for $3,198 off ceiling insulation");
  expect(r.preview?.plainText).toContain("YOUR EXISTING INSULATION\nGood news: it may be able to stay.");
  expect(r.preview?.plainText).toContain("+ If some needs removing: $15/m², only the areas that need it. Up to $2,250 for your 150 m² ceiling.");
  expect(r.preview?.html).toContain("Save my free spot");
  expect(r.preview?.html).not.toContain(REMOVAL_BUDGET_EMAIL_NOTE);
  expect(originalMediaReads).toBe(0);expect(writes).toBe(0);
});
test("an owner declaration without a recorded media review is held for manual review (Jo's T3/T4 says the photos were reviewed)",async()=>{
  reviewed=false;const r=await sendExistingInsulationSaveSpot(id,id,true);
  expect(r.outcome).toBe("blocked");expect(r.detail).toContain("held for manual review");expect(r.preview).toBeUndefined();expect(writes).toBe(0);
});
test("unqualified review cannot prepare the follow-up",async()=>{
  qualified=false;const r=await sendExistingInsulationSaveSpot(id,id,true);
  expect(r.outcome).toBe("blocked");expect(r.detail).toContain("qualifying declaration or approved below-R2 review");expect(r.preview).toBeUndefined();expect(writes).toBe(0);
});
test("real office send remains globally locked with no reservation or delivery",async()=>{
  const r=await sendExistingInsulationSaveSpot(id,id);
  expect(r.outcome).toBe("blocked");expect(writes).toBe(0);
});
test("repeated or uncertain prior follow-up attempts never send again",async()=>{
  enabled=true;
  for (const status of ["sent","sending","delivered_unrecorded","failed"]) {
    data.customer_email_sends={id,status};
    const r=await sendExistingInsulationSaveSpot(id,id);
    expect(r.outcome).toBe("skipped");expect(writes).toBe(0);
  }
});

test("inactive or expired secure links remain blocked with no preview or writes",async()=>{
  for(const invalid of [{status:"revoked",expires_at:new Date(Date.now()+86_400_000).toISOString()},{status:"active",expires_at:new Date(Date.now()-86_400_000).toISOString()}]){
    Object.assign(data.customer_estimate_links as Record<string, unknown>,invalid);
    const r=await sendExistingInsulationSaveSpot(id,id,true);
    expect(r.outcome).toBe("blocked");expect(r.detail).toContain("current secure estimate link");expect(r.preview).toBeUndefined();expect(writes).toBe(0);
  }
});
test("an estimate on a different owner area remains blocked without a misleading preview",async()=>{
  (data.jobs as Record<string, unknown>).estimated_area_m2=160;
  const r=await sendExistingInsulationSaveSpot(id,id,true);
  expect(r.outcome).toBe("blocked");expect(r.detail).toContain("not priced on the owner's ceiling size");expect(r.preview).toBeUndefined();expect(writes).toBe(0);
});
