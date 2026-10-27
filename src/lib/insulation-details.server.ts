import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { campaignLink } from "./launch-campaign.server";
import { insulationDraftSaveAllowed, insulationTapRoute, savedInsulationTap, type InsulationTapAnswers } from "./insulation-details.core";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function saveInsulationTapAnswers(token:string,answers:InsulationTapAnswers,preview:boolean) {
  const c=await campaignLink(token);
  if(!c || c.group!=="onsite" || !c.criteriaPassed) throw new Error("This request is not available. Please contact us.");
  // Preview never alters a real owner record; the published site saves real owners (Jo 24 Oct: "Fix the saving").
  if(!insulationDraftSaveAllowed(preview,c.job.source)) throw new Error("This preview can only save TEST enquiries.");
  const route=insulationTapRoute(answers);
  // Already saved (double tap / second device): don't rewrite answers; the spot-save step is idempotent.
  const { data: existing } = await admin.from("lead_campaign_responses").select("spot_saved_at").eq("job_id", c.job.id).maybeSingle();
  if (existing?.spot_saved_at) {
    const prior = savedInsulationTap((c.job.properties as { enrichment: Record<string, unknown> | null } | null)?.enrichment);
    return { ok: true as const, route: prior ? insulationTapRoute(prior.answers) : route, alreadySaved: true };
  }
  const result=await (admin as SupabaseClient).rpc("save_owner_insulation_details",{p_token:token,p_answers:answers});
  if(result.error) { console.error("save_owner_insulation_details failed", c.job.id, result.error.message); throw new Error("We couldn't save your answers just now. Please try again in a minute."); }
  // Jo 23 Oct 08:14 UTC: everyone who answers gets Save my spot automatically — OFF until Jo approves wording and says go.
  const { INSULATION_QUESTIONS_SEND_APPROVED } = await import("./insulation-questions-campaign.core");
  if (route !== "ineligible" && INSULATION_QUESTIONS_SEND_APPROVED && !preview) {
    const { sendAnsweredOwnerSaveSpot } = await import("./insulation-questions-campaign.server");
    await sendAnsweredOwnerSaveSpot(c.job.id).catch(() => null);
  }
  return {ok:true as const,route,alreadySaved:false};
}
