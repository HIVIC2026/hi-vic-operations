// Exercise the actual office follow-up sender without external delivery or hosted data.
import { beforeEach, expect, mock, test } from "bun:test";
let qualified = true, enabled = false, reviewed = true;
let originalMediaReads = 0, writes = 0;
const token = "A".repeat(43), id = "00000000-0000-4000-8000-000000000001";
const data: Record<string, unknown> = {
  jobs: {id,job_number:"HV-TEST",source:"base44",stage:"preliminary_estimate_ready",eligibility_outcome:"needs_onsite_confirmation",owners:{full_name:"TEST Owner",email:"test@example.test"},properties:{address_line:"TEST",suburb:"TEST",postcode:"3000"}},
  customer_estimate_links: {id,token}, indicative_estimates: {id,area_m2:150,insulation_declared:"present",scenarios:[{removal:0,removal_m2:0,by_access:{standard:{estimated_customer_total:2000,applied_discount:3198,pre_discount_total:5198}}}],snapshot:{settings:{piesa_assessment_inc_gst:349,ap_management_inc_gst:349},scenarios:[{by_access:{standard:{installation:4500}}}]}},
  retail_estimator_settings:{indicative_veec_value:70},
};
mock.module("@/integrations/supabase/client.server", () => ({supabaseAdmin:{from(table: string) {
  const q = {select(){return q;},eq(){return q;},maybeSingle:async()=>({data:data[table]??null,error:null}),insert(){writes++;return q;},update(){writes++;return q;},single:async()=>({data:{id},error:null})};return q;
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
beforeEach(()=>{qualified=true;enabled=false;reviewed=true;writes=0;originalMediaReads=0;delete data.customer_email_sends;});
test("office below-R2 preview uses follow-up renderer despite original media",async()=>{
  const r = await sendExistingInsulationSaveSpot(id,id,true);
  expect(r.preview?.html).toContain("This estimate does not include removal of existing insulation.");
  expect(r.preview?.html).toContain("Save my spot →");
  expect(originalMediaReads).toBe(0);expect(writes).toBe(0);
});
test("audited qualifying owner declaration uses the same truthful renderer",async()=>{
  reviewed=false;const r=await sendExistingInsulationSaveSpot(id,id,true);
  expect(r.preview?.html).toContain("This estimate does not include removal of existing insulation.");
});
test("unqualified review cannot prepare the follow-up",async()=>{
  qualified=false;const r=await sendExistingInsulationSaveSpot(id,id,true);
  expect(r.outcome).toBe("blocked");expect(r.preview).toBeUndefined();expect(writes).toBe(0);
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