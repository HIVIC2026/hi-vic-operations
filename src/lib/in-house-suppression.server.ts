import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { jobHeldByInHousePartner } from "./in-house.core";

export type InHouseDispatchState = { held: Set<string>; failed: boolean };

/** One joined read for the whole sweep; never a per-job business lookup or stale flag cache. */
export async function readInHouseDispatchState(jobIds?: string[]): Promise<InHouseDispatchState> {
  if (jobIds?.length === 0) return { held: new Set(), failed: false };
  try {
    const client = admin as unknown as SupabaseClient;
    let query = client.from("job_assignments")
      .select("job_id, business_id, businesses(in_house), jobs!inner(deleted_at, source)")
      .eq("role", "installer").eq("active", true).is("jobs.deleted_at", null).neq("jobs.source", "qa_test");
    if (jobIds) query = query.in("job_id", [...new Set(jobIds)]);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data) throw new Error("Installer assignments unavailable");
    const held = new Set<string>();
    for (const row of data ?? []) {
      const business = row.businesses as unknown as { in_house: boolean } | null;
      if (row.business_id && (!business || typeof business.in_house !== "boolean")) throw new Error("Installer business flag unavailable");
      if (jobHeldByInHousePartner({ activeInstallerBusiness: business })) held.add(row.job_id);
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