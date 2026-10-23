// Stage 6 (Jo 22 Oct 2026): when a Ready Check finishes cleanly, prepare the owner quote, then hold it for
// 15 minutes so the office can still stop it. OFF by default: workflow_settings.mitti_auto_quote_enabled
// (pending migration — the code fails closed while the column is missing, exactly like the auto-pickup switch).
// Nothing here sends anything: the only release path stays releaseQueuedQuotes(), which re-checks the launch
// switches, consent, intake readiness and electrical billing on every run.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";

const NEEDS_OFFICE = "ready_check_needs_office";

/** One item per distinct reason set: the same failure never floods the office list on every sync. */
export async function recordNeedsOffice(jobId: string, actorId: string | null, quoteId: string | null, reasons: string[]) {
  const { data: last } = await admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", NEEDS_OFFICE)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const prior = ((last?.details as { reasons?: string[] } | null)?.reasons ?? []).join(" | ");
  if (prior === reasons.join(" | ")) return;
  await logEvent(jobId, actorId, NEEDS_OFFICE, `Ready Check finished — the office must act before the owner quote: ${reasons.join("; ")}`,
    { quote_id: quoteId, reasons, needs_office: true }, { internal: true });
}

export type AutoQuoteResult = { action: "off" | "review" | "held" | "blocked"; reasons?: string[] };

/**
 * Called by the Mitti sync right after a completed Ready Check has drafted the installer's owner quote.
 * Checks the form's own answers (below R2, photos, life support, contact permission, price, electrician),
 * then the same send guards the office button runs, then arms the 15-minute window.
 */
export async function maybeAutoQueueReadyCheckQuote(jobId: string, actorId: string | null, entries: { label: string; value: unknown }[], formComplete: boolean): Promise<AutoQuoteResult> {
  // Retained for legacy callers only. Jo 23 Oct: no timer, no automatic queue/approval or sending.
  void jobId; void actorId; void entries; void formComplete;
  return { action: "off" };
}
