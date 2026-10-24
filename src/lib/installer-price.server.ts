// Decision 278 (Jo 25 Oct 2026): READ side of the business owner's price for an installer-supplied job (A1), kept as the
// append-only `installer_price_set` workflow event (latest wins). This module sits on the autoAdvance graph (basics check,
// quote draft, chase, auto-send), so it only reads: no Mitti, no senders. Saving lives in installer-price-set.server.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { INSTALLER_PRICE_EVENT, installerPriceFromEvent, withInstallerPrice, type InstallerPriceRecord } from "./installer-price.core";

export type StoredInstallerPrice = { record: InstallerPriceRecord; setAt: string; setBy: string | null };

/** Latest portal price on the job, or null when the business owner has not entered one. */
export async function readInstallerPrice(jobId: string): Promise<StoredInstallerPrice | null> {
  const { data, error } = await admin.from("workflow_events").select("details, created_at, actor_id").eq("job_id", jobId).eq("event_type", INSTALLER_PRICE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new WorkflowError("The price could not be read.");
  const record = installerPriceFromEvent(data?.details);
  return record ? { record, setAt: String(data!.created_at), setBy: (data!.actor_id as string | null) ?? null } : null;
}

/** Latest portal price per job, batched (home list). Jobs without one are absent from the map. */
export async function readInstallerPrices(jobIds: string[]): Promise<Map<string, InstallerPriceRecord>> {
  const out = new Map<string, InstallerPriceRecord>();
  if (!jobIds.length) return out;
  const { data } = await admin.from("workflow_events").select("job_id, details, created_at").in("job_id", jobIds).eq("event_type", INSTALLER_PRICE_EVENT).order("created_at", { ascending: false });
  for (const row of data ?? []) { if (row.job_id && !out.has(row.job_id)) { const r = installerPriceFromEvent(row.details); if (r) out.set(row.job_id, r); } }
  return out;
}

/** The form snapshot with the portal price in front of any old-form price answers (every reader keeps working). */
export async function entriesWithInstallerPrice<T extends { label: string; value: unknown }>(jobId: string, entries: T[]): Promise<(T | { label: string; value: string | null })[]> {
  const stored = await readInstallerPrice(jobId).catch(() => null);
  return withInstallerPrice(entries, stored?.record ?? null);
}
