import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { readInHouseDispatchState } from "./in-house-suppression.server";
import { partnerBillsRectification, type InHouseBusiness } from "./in-house.core";

/** Billing exceptions always require both the held lookup and the current active installer's configuration. */
export async function partnerBilledRectificationFor(jobId: string): Promise<boolean> {
  const state = await readInHouseDispatchState([jobId]);
  if (state.failed) throw new Error("Couldn't check the job's partner — please try again.");
  if (!state.held.has(jobId)) return false;
  const { data, error } = await admin.from("job_assignments").select("businesses(in_house, rectification_billed_by)").eq("job_id", jobId).eq("role", "installer").eq("active", true).single();
  if (error || !data?.businesses) throw new Error("Couldn't check the job's partner — please try again.");
  return partnerBillsRectification(data.businesses as unknown as InHouseBusiness);
}

/** Optional sync/clearance extension: uncertainty keeps the legacy gate, never aborts its caller. */
export async function optionalPartnerBilledRectificationFor(jobId: string): Promise<boolean> {
  try { return await partnerBilledRectificationFor(jobId); }
  catch (error) { console.error('In-house rectification extension skipped', error instanceof Error ? error.message : 'Partner read failed'); return false; }
}