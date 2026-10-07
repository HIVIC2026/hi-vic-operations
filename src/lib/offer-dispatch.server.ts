// "How job offers go out": reads the global mode + per-job override. Fails closed to office picks.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { officePicks } from "./offer-dispatch.core";
import { suggestAfterHours } from "./offer-timing.core";

/** Hours before "Suggest another time" unlocks (workflow_settings, default 24). */
export async function offerSuggestHours() {
  const { data } = await admin.from("workflow_settings").select("offer_suggest_time_after_hours").eq("id", 1).maybeSingle();
  return suggestAfterHours(data?.offer_suggest_time_after_hours);
}

export async function dispatchMode() {
  const { data } = await admin.from("workflow_settings").select("offer_dispatch_mode").eq("id", 1).maybeSingle();
  return (data?.offer_dispatch_mode ?? "office_picks") as string;
}

export async function jobOfficePicks(jobId: string) {
  const [mode, { data: j }] = await Promise.all([dispatchMode(), admin.from("jobs").select("offer_dispatch_override").eq("id", jobId).maybeSingle()]);
  return officePicks(mode, j?.offer_dispatch_override ?? null);
}

/** Office-chosen offers stay open past the "suggest another time" point so the 24h rule can actually apply. */
export async function chosenOfferExpiry(now = new Date()) {
  return new Date(now.getTime() + ((await offerSuggestHours()) + 48) * 3_600_000).toISOString();
}
