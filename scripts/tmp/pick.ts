import { supabaseAdmin as a } from "../../src/integrations/supabase/client.server";
const { data: jobs } = await a.from("jobs").select("id, job_number").eq("source","qa_test").order("created_at",{ascending:false}).limit(80);
const { campaignLink } = await import("../../src/lib/launch-campaign.server") as any;
for (const j of jobs ?? []) {
  const { data: r } = await a.from("lead_campaign_responses").select("spot_saved_at").eq("job_id", j.id).maybeSingle();
  if (r?.spot_saved_at) continue;
  const { data: l } = await a.from("customer_estimate_links").select("token").eq("job_id", j.id).order("created_at",{ascending:false}).limit(1).maybeSingle();
  if (!l?.token) continue;
  const c = await campaignLink(l.token).catch(()=>null);
  if (c) { console.log(j.job_number, l.token, c.group); }
}
