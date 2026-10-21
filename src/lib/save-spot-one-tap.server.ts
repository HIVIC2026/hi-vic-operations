import { verifyOneTapCredential } from "./save-spot-one-tap.core";
/** No alternate save writes: the canonical action rechecks current consent/link/eligibility. */
export async function redeemOneTap(credential: string) {
  const token = await verifyOneTapCredential(credential, process.env["SAVE_SPOT_LINK_SECRET"] ?? "");
  if (!token) throw new Error("This link is no longer available.");
  const { campaignLink, saveCampaignSpot } = await import("./launch-campaign.server");
  const c = await campaignLink(token);
  if (!c) throw new Error("This link is no longer available.");
  const { jobDeletedBlocker } = await import("./job-live.server");
  if (await jobDeletedBlocker(c.job.id)) throw new Error("This link is no longer available.");
  await saveCampaignSpot(token);
  return { token };
}