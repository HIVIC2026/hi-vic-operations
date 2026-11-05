// Totals check at every point a quote becomes visible to the owner. A mismatch or an unreadable quote holds it instead.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { QUOTE_TOTALS_HOLD_REASON, quoteTotalsMismatch } from "./quote-totals.core";

/** null = the quote's lines and totals agree and may be sent. A failed read returns a reason too: never release on a failed read. */
export async function quoteTotalsHoldReason(quoteId: string): Promise<string | null> {
  const [q, items] = await Promise.all([
    admin.from("quotes").select("subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst").eq("id", quoteId).maybeSingle(),
    admin.from("quote_items").select("line_total_inc_gst").eq("quote_id", quoteId),
  ]);
  if (q.error || !q.data) return "Quote could not be read to check its totals";
  if (items.error || !items.data) return "Quote lines could not be read to check its totals";
  return quoteTotalsMismatch(
    { subtotal_inc_gst: Number(q.data.subtotal_inc_gst), veec_discount_inc_gst: Number(q.data.veec_discount_inc_gst), customer_total_inc_gst: Number(q.data.customer_total_inc_gst) },
    items.data.map((i) => ({ line_total_inc_gst: Number(i.line_total_inc_gst) })),
  );
}

/** Puts the quote back to a held draft for the office and records why. */
export async function holdForTotals(quoteId: string, jobId: string, reason: string, actorId: string | null = null): Promise<void> {
  const { error } = await admin.from("quotes")
    .update({ status: "draft", sent_at: null, release_state: "held", release_hold_reason: QUOTE_TOTALS_HOLD_REASON })
    .eq("id", quoteId).in("status", ["draft", "issued"]);
  if (error) console.error(`[quote-totals] could not hold quote ${quoteId}: ${error.message}`);
  await logEvent(jobId, actorId, "quote_totals_mismatch", QUOTE_TOTALS_HOLD_REASON, { quote_id: quoteId, reason, needs_office: true }, { internal: true });
}
