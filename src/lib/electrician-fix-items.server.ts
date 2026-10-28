// Jo 28 Oct 2026 (spec rule 3): electrician staff can still add "Other" fix items with a description, but never see or
// enter a price. The electrician business owner, or the office, sets the price. "Owner" = admin of the electrician
// business on THIS job (crew-no-price.server `ownsJobBusiness`). A staff item is saved with no price and
// `needs_office_pricing`, so it waits in the existing flow (office To do + price form; completeAssessment and the fixes
// quote send already refuse while an item needs pricing).
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";

export const STAFF_PRICE_REFUSED = "Only your business owner or the office can set a price. Add the item without a price.";
export const STAFF_PRICING_REFUSED = "Only your business owner or the office can set a price.";
/** Stages where electrician fix items may still be added (and, for the owner, priced): before the owner approves. */
export const FIX_ITEM_STAGES: readonly string[] = ["piesa_scheduled", "assessment_booked", "assessment_booking", "assessment_complete", "rectification_required", "awaiting_owner_rectification_approval"];

/** The office, or the owner of the job's electrician business. Any failure = may not price. */
export async function canPriceFixItems(jobId: string, userId: string, role: string): Promise<boolean> {
  if (role === "admin") return true;
  if (role !== "electrician") return false;
  return (await import("./crew-no-price.server")).ownsJobBusiness(jobId, userId, "electrician");
}

/** The job page's fix items. Staff get no price column at all. */
export async function fixItemsFor(jobId: string, userId: string, role: string) {
  const canPrice = await canPriceFixItems(jobId, userId, role);
  const { data, error } = await admin.from("rectification_items").select("id, description, quantity, is_other, status, needs_office_pricing, other_unit_price_inc_gst, created_at")
    .eq("job_id", jobId).neq("status", "removed").order("created_at");
  if (error) throw new WorkflowError("The electrical fixes items could not be loaded.");
  const items = (data ?? []).map(({ other_unit_price_inc_gst, created_at: _c, ...rest }) => (canPrice ? { ...rest, other_unit_price_inc_gst } : rest));
  return { canPrice, items: items as (typeof items[number] & { other_unit_price_inc_gst?: number | null })[] };
}

/** Approved rate rows for the job page; staff get no price column. */
export async function ratesForViewer<R extends { unit_price_ex_gst?: unknown }>(jobId: string, userId: string, role: string, rates: R[]) {
  if (await canPriceFixItems(jobId, userId, role)) return rates;
  return rates.map(({ unit_price_ex_gst: _p, ...rest }) => rest);
}
