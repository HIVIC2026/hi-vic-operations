import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { campaignLink } from "./launch-campaign.server";
import { insulationDraftSaveAllowed, insulationTapRoute, type InsulationTapAnswers } from "./insulation-details.core";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function saveInsulationTapAnswers(token:string,answers:InsulationTapAnswers,preview:boolean) {
  const c=await campaignLink(token);
  if(!c || c.group!=="onsite" || !c.criteriaPassed) throw new Error("This request is not available. Please contact us.");
  // Preview never alters a real owner record or sends. Practice persistence is separately proven on PGlite.
  if(!insulationDraftSaveAllowed(preview,c.job.source)) throw new Error("These draft questions are not activated. Only TEST enquiries can be saved in preview.");
  const result=await (admin as SupabaseClient).rpc("save_owner_insulation_details",{p_token:token,p_answers:answers});
  if(result.error) throw new Error("These draft questions are not activated yet. Your answers have not been saved.");
  const route=insulationTapRoute(answers);
  // Jo 23 Oct 08:14 UTC: everyone who answers gets Save my spot automatically — OFF until Jo approves wording and says go.
  const { INSULATION_QUESTIONS_SEND_APPROVED } = await import("./insulation-questions-campaign.core");
  if (INSULATION_QUESTIONS_SEND_APPROVED && !preview) {
    const { sendAnsweredOwnerSaveSpot } = await import("./insulation-questions-campaign.server");
    await sendAnsweredOwnerSaveSpot(c.job.id).catch(() => null);
  }
  return {ok:true as const,route};
}