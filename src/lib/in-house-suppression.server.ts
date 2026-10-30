import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobHeldByInHousePartner } from "./in-house.core";

export type InHouseDispatchState = { held: Set<string>; failed: boolean };

/** Active installer assignments for ANY job. Page every scope completely; never cache a partial held set. */
export async function readInHouseDispatchState(jobIds?: string[]): Promise<InHouseDispatchState> {
  if (jobIds?.length === 0) return { held: new Set(), failed: false };
  try {
    const client = admin as unknown as SupabaseClient;
    const held = new Set<string>();
    const pageSize = 200;
    const ids = jobIds ? [...new Set(jobIds)] : undefined;
    const scopes = ids ? Array.from({ length: Math.ceil(ids.length / pageSize) }, (_, i) => ids.slice(i * pageSize, (i + 1) * pageSize)) : [undefined];
    for (const scope of scopes) {
      for (let offset = 0; ; offset += pageSize) {
        let query = client.from("job_assignments")
          .select("job_id, business_id, businesses(in_house)")
          .eq("role", "installer").eq("active", true).order("id").range(offset, offset + pageSize - 1);
        if (scope) query = query.in("job_id", scope);
        const { data, error } = await query;
        if (error) throw new Error(error.message);
        if (!data) throw new Error("Installer assignments unavailable");
        for (const row of data) {
          const business = row.businesses as unknown as { in_house: boolean } | null;
          if (row.business_id && (!business || typeof business.in_house !== "boolean")) throw new Error("Installer business flag unavailable");
          if (jobHeldByInHousePartner({ activeInstallerBusiness: business })) held.add(row.job_id);
        }
        if (data.length < pageSize) break;
      }
    }
    return { held, failed: false };
  } catch (error) {
    console.error("In-house dispatch state unavailable; dispatch stopped", error);
    return { held: new Set(), failed: true };
  }
}

export async function inHouseDispatchSkip(jobId: string, state?: InHouseDispatchState): Promise<"in_house" | "in_house_read_failed" | null> {
  const current = state ?? await readInHouseDispatchState([jobId]);
  return current.failed ? "in_house_read_failed" : current.held.has(jobId) ? "in_house" : null;
}