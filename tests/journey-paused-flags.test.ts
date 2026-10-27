import { expect, mock, test } from "bun:test";

const original = { id:"62956b54-2e44-4c96-a156-33949b20fa82", name:"TEST Alpha Insulation", onboarding_notes:"[TEST PARTNER]", business_type:"eec_installer", service_postcodes:["3199"], coverage_verified_at:"2026-10-01T00:00:00Z", free_measureups_for_hivic_quote_leads:true, accepting_new_jobs:false, receives_hivic_leads:false };
let business = {...original};
const admin = { from(table:string) {
  let patch:Record<string,unknown> | null = null;
  const q = {
    select() { return q; }, eq() { return q; }, like() { return q; },
    update(p:Record<string,unknown>) { patch=p; return q; },
    async maybeSingle() { return {data:business,error:null}; },
    then(resolve:(x:unknown)=>unknown) {
      if (patch) business={...business,...patch};
      return Promise.resolve({data:table==="business_credentials" ? [{kind:"public_liability_insurance",verification:"verified",expires_at:null},{kind:"installer_certification",verification:"verified",expires_at:null}] : null,error:null}).then(resolve);
    },
  }; return q;
} };
mock.module("@/integrations/supabase/client.server",()=>({supabaseAdmin:admin}));
const { ensureTestBusinessReady } = await import("../src/lib/journey-setup.server");
test("TEST journey prepares paused partner, then its existing cleanup snapshot restores both flags",async()=>{
  const before=await ensureTestBusinessReady("office",original.id,"installer",[]);
  expect(business.accepting_new_jobs).toBe(true); expect(business.receives_hivic_leads).toBe(true);
  expect(before.accepting_new_jobs).toBe(false); expect(before.receives_hivic_leads).toBe(false);
  const {id,...restore}=before;
  await admin.from("businesses").update(restore).eq("id",id).like("onboarding_notes","%[TEST PARTNER]%");
  expect(business).toEqual(original);
});