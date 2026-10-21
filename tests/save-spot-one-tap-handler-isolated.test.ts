import { test,expect,mock } from "bun:test";
import { createOneTapCredential } from "../src/lib/save-spot-one-tap.core";
import { launchCampaignDb, LAUNCH_ID } from "./helpers/pglite-launch-campaign";
const db=await launchCampaignDb();let calls=0,available=true,deleted=false;
mock.module("../src/lib/launch-campaign.server",()=>({campaignLink:async()=>available?{job:{id:LAUNCH_ID.job}}:null,saveCampaignSpot:async()=>{calls++;await db.query("insert into lead_campaign_responses(job_id,estimate_link_id,spot_saved_at) values($1,$2,now()) on conflict(job_id) do nothing",[LAUNCH_ID.job,LAUNCH_ID.link]);return {ok:true};}}));
mock.module("../src/lib/job-live.server",()=>({jobDeletedBlocker:async()=>deleted?"Deleted":null}));
const {redeemOneTap}=await import("../src/lib/save-spot-one-tap.server");
process.env.SAVE_SPOT_LINK_SECRET="isolated-test-secret-only-".repeat(3);const token="a".repeat(64);
test("actual one-tap redemption calls canonical save and practice response remains once on duplicate",async()=>{
  const c=await createOneTapCredential(token,Date.now()+60000,process.env.SAVE_SPOT_LINK_SECRET ?? "");
  expect((await redeemOneTap(c)).token).toBe(token);await redeemOneTap(c);
  expect(calls).toBe(2);expect((await db.query<{n:number}>("select count(*)::int n from lead_campaign_responses where spot_saved_at is not null")).rows[0]?.n).toBe(1);
});
test("current canonical refusal and deletion prohibit one-tap save",async()=>{
  const c=await createOneTapCredential(token,Date.now()+60000,process.env.SAVE_SPOT_LINK_SECRET ?? "");available=false;await expect(redeemOneTap(c)).rejects.toThrow();available=true;deleted=true;await expect(redeemOneTap(c)).rejects.toThrow();expect(calls).toBe(2);await db.close();
});