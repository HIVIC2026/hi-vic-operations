// Business public liability insurance expiry (compliance checklist H3, 24 Oct 2026). One read, reused by the
// installer offer pick, the pre-start check and My business, so a lapsed certificate blocks everywhere the same way.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { latestExpiry } from "./trade-view.core";

/** Latest public liability expiry on file for each business (YYYY-MM-DD; null = none recorded). A renewal upload supersedes the old date. */
export async function publicLiabilityExpiryFor(businessIds: readonly string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>(businessIds.map((b) => [b, null]));
  if (!businessIds.length) return out;
  const { data, error } = await admin.from("business_credentials").select("business_id, kind, label, expires_at, verification").in("business_id", [...businessIds]);
  if (error) throw new Error(`Couldn't read insurance records: ${error.message}`);
  for (const id of businessIds) {
    const mine = (data ?? []).filter((c) => c.business_id === id).map((c) => ({ kind: c.kind, label: c.label, expires: c.expires_at, verified: c.verification === "verified" }));
    out.set(id, latestExpiry(mine, "public_liability_insurance"));
  }
  return out;
}
