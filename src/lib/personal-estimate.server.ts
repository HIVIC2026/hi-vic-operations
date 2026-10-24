// P1-R3-COM-09 — read-only personal-estimate resolver (DEP-1).
// Service-role only. Never sends anything, never recalculates with current pricing, never creates or updates an
// estimate, never mutates the pricing cohort, and never triggers a communication. Fails CLOSED (null) on any gap.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { isWellFormedToken, linkUsable, LINK_PURPOSE } from "./estimatelink.core";
import { buildPersonalEstimateView, type SavedEstimateCore, type SavedFeeSettings } from "./personal-estimate.core";
import { formatPropertyAddress } from "./address";

type LinkRow = { id: string; job_id: string; token: string; status: string; expires_at: string };

/** Reuse the existing link rules: well-formed token, purpose=step3_estimate, active and within the 30-day TTL. */
async function usableLinkByToken(token: unknown): Promise<LinkRow | null> {
  if (!isWellFormedToken(token)) return null;
  const { data } = await admin
    .from("customer_estimate_links")
    .select("id, job_id, token, status, expires_at")
    .eq("token", token)
    .eq("purpose", LINK_PURPOSE)
    .maybeSingle();
  return linkUsable(data ?? null) ? (data as LinkRow) : null;
}

/** The frozen Save-My-Spot totals for a job. null when the customer never saved a spot (=> fail closed). */
async function savedCoreForJob(jobId: string): Promise<SavedEstimateCore | null> {
  const { data } = await admin
    .from("lead_campaign_responses")
    .select("saved_total, saved_veu_discount, saved_gross_total, saved_area_m2, saved_insulation, spot_saved_at")
    .eq("job_id", jobId)
    .maybeSingle();
  if (!data?.spot_saved_at) return null;
  return {
    savedTotal: data.saved_total as number | null,
    savedVeuDiscount: data.saved_veu_discount as number | null,
    savedGrossTotal: data.saved_gross_total as number | null,
    savedAreaM2: data.saved_area_m2 as number | null,
    savedInsulation: (data.saved_insulation as string | null) ?? null,
    areaAssumed: false, // refined with the frozen estimate's area_source below
    savedAt: data.spot_saved_at as string,
  };
}

/** Frozen fee settings + whether the saved size was an assumption, read from the CURRENT estimate's snapshot. */
async function frozenFeesAndArea(jobId: string): Promise<{ fees: SavedFeeSettings; areaAssumed: boolean }> {
  const { data: est } = await admin
    .from("indicative_estimates")
    .select("area_source, snapshot")
    .eq("job_id", jobId)
    .eq("status", "current")
    .maybeSingle();
  const settings = (est?.snapshot as { settings?: SavedFeeSettings } | null | undefined)?.settings ?? null;
  return { fees: settings, areaAssumed: !!est && (est as { area_source?: string | null }).area_source !== "declared" };
}

/**
 * DEP-1 public, no-login, READ-ONLY resolver. The token is the only credential and maps to exactly one job/customer,
 * so a token can never read another customer's estimate. Returns null for invalid/expired/missing tokens, deleted jobs,
 * or an incomplete saved snapshot (fail closed). Nothing here is recalculated or written.
 */
export async function resolvePersonalEstimate(token: unknown) {
  const link = await usableLinkByToken(token);
  if (!link) return null;
  const { data: job } = await admin
    .from("jobs")
    .select("id, job_number, deleted_at, property_id")
    .eq("id", link.job_id)
    .maybeSingle();
  if (!job || (job as { deleted_at?: string | null }).deleted_at) return null;
  const core = await savedCoreForJob(link.job_id);
  const { fees, areaAssumed } = await frozenFeesAndArea(link.job_id);
  const view = buildPersonalEstimateView(core ? { ...core, areaAssumed } : null, fees, link.token);
  if (!view) return null;
  // `properties` is a relation on jobs; read the customer's own address via the property FK.
  const propertyId = (job as { property_id?: string | null }).property_id ?? null;
  let address: string | null = null;
  if (propertyId) {
    const { data: prop } = await admin
      .from("properties")
      .select("address_line, suburb, state, postcode")
      .eq("id", propertyId)
      .maybeSingle();
    address = formatPropertyAddress((prop as import("./address").AddressParts | null) ?? null) || null;
  }
  // Public whitelist: the customer's own job reference + address + their saved pricing. No internal ids.
  const { readyCheckBookingAccess } = await import('./ready-check-booking-access.server');
  const booking = await readyCheckBookingAccess(link.job_id);
  return { job: { job_number: job.job_number ?? null, address }, ...view, bookingAllowed: booking.allowed };
}
