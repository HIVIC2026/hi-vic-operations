// Read-only link lookups for email PREVIEWS (STEP 32). Opening a preview never creates an unsubscribe or referral
// token: an existing link is reused, otherwise the preview shows an obvious placeholder and reports linksReady=false.
// Real sends (and the explicit Office "Create sending links" step) still use the creating helpers in
// emailsafety.server.ts / referral.server.ts, so unsubscribe handling of real email is unchanged.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { unsubscribeUrl } from "./emailsafety.core";
import { referralShareUrl } from "./referral.core";
import { PREVIEW_LINK_TOKEN } from "./manual-communication.core";

export { PREVIEW_LINK_TOKEN };
export const PREVIEW_UNSUBSCRIBE_URL = unsubscribeUrl(PREVIEW_LINK_TOKEN);
export const PREVIEW_REFERRAL_URL = referralShareUrl(PREVIEW_LINK_TOKEN);

/** The job's unsubscribe link if a token already exists; null otherwise. Never writes. */
export async function existingUnsubscribeUrl(jobId: string): Promise<string | null> {
  const { data, error } = await admin.from("customer_email_optouts").select("token").eq("job_id", jobId).maybeSingle();
  if (error) throw new Error("Could not read the unsubscribe link. Nothing changed; try again.");
  return data?.token ? unsubscribeUrl(data.token) : null;
}

/** The job's active referral link if one already exists; null otherwise. Never writes. */
export async function existingReferralUrl(jobId: string): Promise<string | null> {
  const { data, error } = await admin.from("customer_referral_tokens").select("token").eq("status", "active").eq("job_id", jobId).maybeSingle();
  if (error) throw new Error("Could not read the referral link. Nothing changed; try again.");
  return data?.token ? referralShareUrl(data.token) : null;
}
