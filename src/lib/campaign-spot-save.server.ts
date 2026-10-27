import { supabaseAdmin as admin } from '@/integrations/supabase/client.server';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Caller has checked its secure link and existing save permissions. No delivery here. */
export async function commitCampaignSpot(jobId: string, linkId: string, snapshot: Record<string, unknown>, onsite: boolean, summary: string, details: Record<string, unknown>) {
  const { error } = await (admin as SupabaseClient).rpc('save_campaign_spot_atomic', {
    p_job: jobId, p_link: linkId, p_snapshot: snapshot, p_onsite: onsite, p_summary: summary, p_details: details,
  });
  if (error) throw new Error(error.message);
}

/** Next secure save-page visit repairs only that job; never invokes a sender. */
export async function repairCampaignSpotStage(jobId: string) {
  const { error } = await (admin as SupabaseClient).rpc('repair_campaign_spot_stage', { p_job: jobId });
  if (error) throw new Error("We couldn't check your saved spot. Please try again.");
}