import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { readFileSync } from "node:fs";
const F = JSON.parse(readFileSync("/tmp/browser/gb2/fixtures.json","utf8"));
for (const [k,f] of Object.entries<any>(F)) {
  const [j,r,ev,md,em,sm] = await Promise.all([
    admin.from("jobs").select("job_number,source,stage,eligibility_outcome,deleted_at").eq("id",f.jobId).single(),
    admin.from("lead_campaign_responses").select("spot_saved_at,opted_out_at").eq("job_id",f.jobId),
    admin.from("workflow_events").select("event_type,created_at").eq("job_id",f.jobId).order("created_at"),
    admin.from("evidence_files").select("storage_path").eq("job_id",f.jobId),
    admin.from("customer_email_sends").select("status,created_at,to_email").eq("job_id",f.jobId),
    admin.from("sms_messages").select("status").eq("job_id",f.jobId),
  ]);
  console.log(k, JSON.stringify({job:j.data, resp:r.data, events:ev.data?.map(e=>e.event_type), files:md.data?.length, emails:em.data??em.error?.message, sms:sm.data??sm.error?.message}));
}
const { count } = await admin.from("customer_email_sends").select("id",{count:"exact",head:true}); console.log("email rows total", count);
const { data: recent, error: re } = await admin.from("customer_email_sends").select("*").gte("created_at","2026-10-09T01:00:00Z").order("created_at");
console.log(re?.message ?? JSON.stringify(recent?.map((r:any)=>({at:r.created_at,status:r.status,job:r.job_id,kind:r.kind??r.template??r.campaign_key??r.email_type, to:String(r.to_email??r.recipient??'').replace(/^(.{3}).*@/,'$1…@')}))));
const { data: ws } = await admin.from("workflow_settings").select("customer_comms_enabled").limit(1); const { data: ds } = await admin.from("customer_delivery_settings").select("enabled").eq("id",1);
console.log("switches", JSON.stringify(ws), JSON.stringify(ds));
