// P1-R3-S102: service-area coverage gate for AUTOMATIC Save-my-spot sending.
//
// Owner rule: an automatic Save My Spot email may only be sent when the required service coverage can
// be POSITIVELY established from EXISTING CRM records. If it cannot, the customer must NOT be
// auto-sent and is left for Office manual review. No new column, no invented postcode rule.
//
// The positive signal is the existing authoritative VEU Victorian location table
// `veu_location_variables.postcode` (source: energy.vic.gov.au VEU specifications). A property whose
// postcode is present there is positively established as a covered VEU Victorian location. Anything
// else — no postcode, an unknown postcode, or an unreadable table — fails CLOSED (no auto-send).
// This does NOT infer installer availability from a postcode; it only establishes that the location
// is a valid, covered VEU service location.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";

/** Stable, machine-readable reason returned to callers when coverage cannot be positively established. */
export const SERVICE_AREA_REASON = "service_area_not_established";

/** Resolve the property's postcode from existing records; null if unknown. */
async function propertyPostcode(jobId: string): Promise<string | null> {
  const { data: job } = await admin.from("jobs").select("properties(postcode)").eq("id", jobId).maybeSingle();
  const prop = job?.properties as { postcode: string | null } | { postcode: string | null }[] | null;
  const fromProp = (Array.isArray(prop) ? prop[0]?.postcode : prop?.postcode) ?? null;
  if (fromProp && String(fromProp).trim()) return String(fromProp).trim();
  const { data: est } = await admin.from("indicative_estimates").select("postcode").eq("job_id", jobId).eq("status", "current").maybeSingle();
  const fromEst = (est?.postcode as string | null) ?? null;
  return fromEst && String(fromEst).trim() ? String(fromEst).trim() : null;
}

/**
 * True only when service coverage can be POSITIVELY established from existing records (a recognised
 * VEU Victorian postcode). Fail-closed: unknown/unreadable => false (no automatic send).
 */
export async function serviceCoverageEstablished(jobId: string): Promise<boolean> {
  const postcode = await propertyPostcode(jobId);
  if (!postcode) return false;
  const { data, error } = await admin.from("veu_location_variables").select("postcode").eq("postcode", postcode).maybeSingle();
  if (error || !data) return false;
  return true;
}
