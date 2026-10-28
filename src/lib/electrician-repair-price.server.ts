// Task 9 (Jo 28 Oct 2026): READ side of the electrician repair price (append-only `electrician_repair_price_set`, latest
// wins, tied to its A3 form). Every fixes-quote reader (quotes.server generation, the decision-354 automatic send) takes
// the portal price FIRST through `fixesPriceSourceForJob`; an old form's own price is the fallback. Sits on the quote /
// autoAdvance paths, so it only reads: no senders, no writes. Saving lives in electrician-repair-price-set.server.ts.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { fixesPriceSource, type FixesPriceSource } from "./fixes-price.core";
import { shortAnswersFromEntries } from "./official-short.core";
import { REPAIR_PRICE_EVENT, repairPriceFromEvent } from "./electrician-repair-price.core";

export type StoredRepairPrice = { priceIncGst: number; setAt: string; by: "owner" | "office" | null };

/** Latest portal repair price for this job's A3 form, or null. A failed read THROWS (never "no price"). */
export async function readRepairPrice(jobId: string, auditId: string | null | undefined): Promise<StoredRepairPrice | null> {
  if (!auditId) return null;
  const { data, error } = await admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", REPAIR_PRICE_EVENT).contains("details", { audit_id: auditId }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`The repair price could not be read: ${error.message}`);
  const price = repairPriceFromEvent(data?.details, auditId);
  if (price == null) return null;
  const by = (data!.details as Record<string, unknown>)["by"];
  return { priceIncGst: price, setAt: String(data!.created_at), by: by === "owner" || by === "office" ? by : null };
}

/** The synced A3 answers and form id (empty when no form yet). */
export async function a3ForJob(jobId: string): Promise<{ auditId: string | null; completed: boolean; short: Record<string, string> | null }> {
  const { data: a, error } = await admin.from("assessments").select("external_mitti_id, mitti_completed, mitti_raw_snapshot").eq("job_id", jobId).maybeSingle();
  if (error) throw new Error(`The safety check form could not be read: ${error.message}`);
  const entries = Array.isArray(a?.mitti_raw_snapshot) ? (a!.mitti_raw_snapshot as { label: string; value: string | null }[]).filter((e) => e && typeof e.label === "string") : [];
  return { auditId: (a?.external_mitti_id as string | null | undefined) ?? null, completed: a?.mitti_completed === true, short: entries.length ? shortAnswersFromEntries("piesa", entries) : null };
}

/** Decision 305 + Task 9: how the fixes quote is priced — the portal price first, the A3 form's own price as fallback. */
export async function fixesPriceSourceForJob(jobId: string): Promise<FixesPriceSource> {
  const a3 = await a3ForJob(jobId);
  const stored = await readRepairPrice(jobId, a3.auditId);
  return fixesPriceSource(a3.short, stored?.priceIncGst ?? null);
}
