import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { USUAL_ELECTRICIAN_EVENT } from "./usual-electrician.core";
import { readUsualElectrician } from "./usual-electrician.server";
import { signupMainElectrician } from "./signup-electrician.core";

/** On approval: keep the electrician the installer named at sign-up as their usual electrician (unless one is already saved)
 *  and attach that application's electrician nominations to the business. "Nothing to do" returns a reason; DB errors throw. */
export async function carrySignupElectrician(businessId: string, actorId: string | null): Promise<{ saved: boolean; reason?: "no_application" | "no_electrician" | "already_saved" }> {
  const { data: act, error: ae } = await admin.from("partner_activations").select("application_id").eq("business_id", businessId).limit(1).maybeSingle();
  if (ae) throw new Error(`Could not load the sign-up link: ${ae.message}`);
  if (!act?.application_id) return { saved: false, reason: "no_application" };
  const { data: app, error: pe } = await admin.from("rec_onboarding_applications").select("data").eq("id", act.application_id).maybeSingle();
  if (pe) throw new Error(`Could not load the sign-up: ${pe.message}`);
  const electrician = signupMainElectrician(app?.data);
  if (!electrician) return { saved: false, reason: "no_electrician" };
  const { error: ne } = await admin.from("electrician_nominations").update({ nominating_business_id: businessId } as never).eq("installer_application_id", act.application_id).is("nominating_business_id", null);
  if (ne) throw new Error(`Could not link the sign-up electrician nominations: ${ne.message}`);
  if ((await readUsualElectrician(businessId)).electrician) return { saved: false, reason: "already_saved" };
  const { error } = await admin.from("admin_config_events").insert({ actor_id: actorId, event_type: USUAL_ELECTRICIAN_EVENT,
    summary: "Usual electrician saved from installer sign-up on approval", details: { business_id: businessId, electrician, source: "installer_signup" } });
  if (error) throw new Error(`Could not save the sign-up electrician: ${error.message}`);
  return { saved: true };
}
