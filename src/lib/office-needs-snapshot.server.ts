// Decision 382: Needs me from a saved copy (office_needs_snapshot, server-only). Serves the copy at once and refreshes
// it after the response (one refresher at a time); the 15-minute tick keeps the live copy warm. Rules in the .core.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAfterResponse } from "./background.server";
import { loadNeedsMePage, type NeedsMePage } from "./office-needs.server";
import { NEEDS_REFRESH_CLAIM_MS, needsSnapshotKey, needsSnapshotPlan } from "./office-needs-snapshot.core";

const loose = admin as unknown as SupabaseClient;
const TABLE = "office_needs_snapshot";

export type NeedsMeSnapshot = NeedsMePage & { computedAt: string; refreshing: boolean };

async function computeAndSave(includeTest: boolean): Promise<NeedsMeSnapshot> {
  const page = await loadNeedsMePage(includeTest);
  const computedAt = new Date().toISOString();
  const { error } = await loose.from(TABLE).upsert({ key: needsSnapshotKey(includeTest), payload: page, computed_at: computedAt, refreshing_at: null });
  if (error) console.error("Needs me copy not saved", error.message);
  return { ...page, computedAt, refreshing: false };
}

/** Claims the one background refresh; false when another refresh is already running. */
async function claimRefresh(key: string): Promise<boolean> {
  const stale = new Date(Date.now() - NEEDS_REFRESH_CLAIM_MS).toISOString();
  const { data, error } = await loose.from(TABLE).update({ refreshing_at: new Date().toISOString() }).eq("key", key)
    .or(`refreshing_at.is.null,refreshing_at.lt.${stale}`).select("key");
  return !error && (data ?? []).length > 0;
}

export async function getNeedsMeSnapshot(includeTest: boolean, force = false): Promise<NeedsMeSnapshot> {
  const key = needsSnapshotKey(includeTest);
  const { data: row, error } = await loose.from(TABLE).select("payload, computed_at, refreshing_at").eq("key", key).maybeSingle();
  if (error) return computeAndSave(includeTest); // table missing or unreadable: behave exactly as before
  const r = row as { payload: NeedsMePage; computed_at: string; refreshing_at: string | null } | null;
  const plan = needsSnapshotPlan(r ? Date.now() - new Date(r.computed_at).getTime() : null, force);
  if (plan === "compute_now" || !r) return computeAndSave(includeTest);
  let refreshing = !!r.refreshing_at && Date.now() - new Date(r.refreshing_at).getTime() < NEEDS_REFRESH_CLAIM_MS;
  if (plan === "serve_and_refresh" && await claimRefresh(key)) {
    runAfterResponse(() => computeAndSave(includeTest));
    refreshing = true;
  }
  return { ...r.payload, computedAt: r.computed_at, refreshing };
}

/** 15-minute tick: keep the live copy warm so the first open of the day is instant. */
export async function refreshNeedsMeSnapshot(): Promise<{ total: number }> {
  const s = await computeAndSave(false);
  return { total: s.total };
}
