// Decision 278 (Jo 25 Oct 2026): READ side of the business owner's price for an installer-supplied job (A1), kept as the
// append-only `installer_price_set` workflow event (latest wins). This module sits on the autoAdvance graph (basics check,
// quote draft, chase, auto-send), so it only reads: no Mitti, no senders. Saving lives in installer-price-set.server.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { INSTALLER_PRICE_EVENT, installerPriceFromEvent, withInstallerPrice, withoutFormPrice, type InstallerPriceRecord } from "./installer-price.core";

export type StoredInstallerPrice = { record: InstallerPriceRecord; setAt: string; setBy: string | null };

/** Batch 3a: the owner asked for a new quote after the old one expired — prices entered before that are not reused. */
const NEW_QUOTE_REQUESTED_EVENT = "new_quote_requested";

/** The latest portal price, and whether a new-quote request is waiting for a price entered after it. */
async function readPriceState(jobId: string): Promise<{ stored: StoredInstallerPrice | null; askedAgain: boolean }> {
  const [{ data, error }, { data: reset, error: re }] = await Promise.all([
    admin.from("workflow_events").select("details, created_at, actor_id").eq("job_id", jobId).eq("event_type", INSTALLER_PRICE_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", NEW_QUOTE_REQUESTED_EVENT).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || re) throw new WorkflowError("The price could not be read.");
  if (reset && (!data || String(reset.created_at) >= String(data.created_at))) return { stored: null, askedAgain: true };
  const record = installerPriceFromEvent(data?.details);
  return { stored: record ? { record, setAt: String(data!.created_at), setBy: (data!.actor_id as string | null) ?? null } : null, askedAgain: false };
}

/** Latest portal price on the job, or null when the business owner has not entered one since the last new-quote request. */
export async function readInstallerPrice(jobId: string): Promise<StoredInstallerPrice | null> {
  return (await readPriceState(jobId)).stored;
}

/** Latest portal price per job, batched (home list). Jobs without one are absent from the map. */
export async function readInstallerPrices(jobIds: string[]): Promise<Map<string, InstallerPriceRecord>> {
  const out = new Map<string, InstallerPriceRecord>();
  if (!jobIds.length) return out;
  const [{ data }, { data: resets }] = await Promise.all([
    admin.from("workflow_events").select("job_id, details, created_at").in("job_id", jobIds).eq("event_type", INSTALLER_PRICE_EVENT).order("created_at", { ascending: false }),
    admin.from("workflow_events").select("job_id, created_at").in("job_id", jobIds).eq("event_type", NEW_QUOTE_REQUESTED_EVENT),
  ]);
  const resetAt = new Map<string, string>();
  for (const r of resets ?? []) { const k = String(r.job_id); const at = String(r.created_at); if (!resetAt.has(k) || at > resetAt.get(k)!) resetAt.set(k, at); }
  for (const row of data ?? []) {
    if (!row.job_id || out.has(row.job_id)) continue;
    const reset = resetAt.get(row.job_id);
    if (reset && reset >= String(row.created_at)) continue; // entered before the new-quote request: not reused
    const r = installerPriceFromEvent(row.details); if (r) out.set(row.job_id, r);
  }
  return out;
}

/** The form snapshot with the portal price in front of any old-form price answers (every reader keeps working).
 *  Batch 3a: after an owner's new-quote request with no portal price since, an old form's own price is dropped too (the
 *  old price is never reused — the business owner enters a new one). */
export async function entriesWithInstallerPrice<T extends { label: string; value: unknown }>(jobId: string, entries: T[]): Promise<(T | { label: string; value: string | null })[]> {
  const s = await readPriceState(jobId).catch(() => ({ stored: null, askedAgain: false }));
  if (s.stored) return withInstallerPrice(entries, s.stored.record);
  return s.askedAgain ? withoutFormPrice(entries) : entries;
}
