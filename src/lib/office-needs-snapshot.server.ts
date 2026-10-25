// Decision 382: Needs me from a saved copy (office_needs_snapshot, server-only). Serves the copy at once and refreshes
// it after the response (one refresher at a time); the 15-minute tick keeps the live copy warm. Rules in the .core.
// Decision 383: the default first page of Jobs › Active and of Enquiries use the same table under their own keys.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAfterResponse } from "./background.server";
import { loadNeedsMePage, type NeedsMePage } from "./office-needs.server";
import { loadActiveJobsList, loadEnquiriesList, type EnquiryListParams, type JobsListParams } from "./office-lists.server";
import { LIST_SNAPSHOT_KEYS, NEEDS_REFRESH_CLAIM_MS, isDefaultListView, listSnapshotPlan, needsSnapshotKey, needsSnapshotPlan, type NeedsSnapshotPlan } from "./office-needs-snapshot.core";

const loose = admin as unknown as SupabaseClient;
const TABLE = "office_needs_snapshot";

type Copy = { computedAt: string; refreshing: boolean };
export type NeedsMeSnapshot = NeedsMePage & Copy;

async function computeAndSave<T extends object>(key: string, compute: () => Promise<T>): Promise<T & Copy> {
  const page = await compute();
  const computedAt = new Date().toISOString();
  const { error } = await loose.from(TABLE).upsert({ key, payload: page, computed_at: computedAt, refreshing_at: null });
  if (error) console.error(`Saved copy ${key} not saved`, error.message);
  return { ...page, computedAt, refreshing: false };
}

/** Claims the one background refresh; false when another refresh is already running. */
async function claimRefresh(key: string): Promise<boolean> {
  const stale = new Date(Date.now() - NEEDS_REFRESH_CLAIM_MS).toISOString();
  const { data, error } = await loose.from(TABLE).update({ refreshing_at: new Date().toISOString() }).eq("key", key)
    .or(`refreshing_at.is.null,refreshing_at.lt.${stale}`).select("key");
  return !error && (data ?? []).length > 0;
}

/** One read of the saved copy; then serve it, serve it and refresh it after the response, or work it out now. */
async function served<T extends object>(key: string, compute: () => Promise<T>, plan: (ageMs: number | null) => NeedsSnapshotPlan): Promise<T & Copy> {
  const { data: row, error } = await loose.from(TABLE).select("payload, computed_at, refreshing_at").eq("key", key).maybeSingle();
  if (error) return computeAndSave(key, compute); // table missing or unreadable: behave exactly as before
  const r = row as { payload: T; computed_at: string; refreshing_at: string | null } | null;
  const p = plan(r ? Date.now() - new Date(r.computed_at).getTime() : null);
  if (p === "compute_now" || !r) return computeAndSave(key, compute);
  let refreshing = !!r.refreshing_at && Date.now() - new Date(r.refreshing_at).getTime() < NEEDS_REFRESH_CLAIM_MS;
  if (p === "serve_and_refresh" && await claimRefresh(key)) {
    runAfterResponse(() => computeAndSave(key, compute));
    refreshing = true;
  }
  return { ...r.payload, computedAt: r.computed_at, refreshing };
}

export async function getNeedsMeSnapshot(includeTest: boolean, force = false): Promise<NeedsMeSnapshot> {
  return served(needsSnapshotKey(includeTest), () => loadNeedsMePage(includeTest), (age) => needsSnapshotPlan(age, force));
}

/** 15-minute tick: keep the live copy warm so the first open of the day is instant. */
export async function refreshNeedsMeSnapshot(): Promise<{ total: number }> {
  const s = await computeAndSave(needsSnapshotKey(false), () => loadNeedsMePage(false));
  return { total: s.total };
}

// Decision 383. `fromCopy` = this answer came from the saved copy (the screen says when it was checked).
const DEFAULT_JOBS: JobsListParams = { search: "", sort: "", dir: "desc", page: 1, filters: {}, includeTest: false };
const DEFAULT_ENQUIRIES: EnquiryListParams = { search: "", sort: "", dir: "asc", page: 1, filters: {} };
const live = <T extends object>(page: T) => ({ ...page, computedAt: new Date().toISOString(), refreshing: false, fromCopy: false });

/** Jobs › Active: the default first page from the saved copy, every other view live. `force` = the office just acted. */
export async function getActiveJobsListServed(p: JobsListParams, force = false) {
  if (!isDefaultListView(p)) return live(await loadActiveJobsList(p));
  const out = await served(LIST_SNAPSHOT_KEYS.jobs, () => loadActiveJobsList(DEFAULT_JOBS), (age) => listSnapshotPlan(age, force));
  return { ...out, fromCopy: true };
}

/** Enquiries: the default first page from the saved copy, every other view live. `force` = the office just acted. */
export async function getEnquiriesListServed(p: EnquiryListParams, force = false) {
  if (!isDefaultListView(p)) return live(await loadEnquiriesList(p));
  const out = await served(LIST_SNAPSHOT_KEYS.enquiries, () => loadEnquiriesList(DEFAULT_ENQUIRIES), (age) => listSnapshotPlan(age, force));
  return { ...out, fromCopy: true };
}

/** 15-minute tick: keep both default list pages warm. */
export async function refreshListSnapshots(): Promise<{ jobs: number; enquiries: number }> {
  const [jobs, enquiries] = await Promise.all([
    computeAndSave(LIST_SNAPSHOT_KEYS.jobs, () => loadActiveJobsList(DEFAULT_JOBS)),
    computeAndSave(LIST_SNAPSHOT_KEYS.enquiries, () => loadEnquiriesList(DEFAULT_ENQUIRIES)),
  ]);
  return { jobs: jobs.all, enquiries: enquiries.counts.open };
}
