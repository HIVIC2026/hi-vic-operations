// Jo 24 Oct 2026: the latest Ready Check owner quote and its status for the installer (no approval step). Read-only;
// callers authorise first. Never sends to owners and never reads or writes the retired installer approval events.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { WorkflowError } from "./workflow.server";
import { isReadyCheckQuote, type InstallerQuoteFacts } from "./installer-quote-status.core";

const QUOTE_COLS = "id, job_id, status, sent_at, release_state, release_hold_reason, option_code, created_at, subtotal_inc_gst, veec_discount_inc_gst, customer_total_inc_gst, quote_items(code, description, explanation, quantity, unit, unit_price_inc_gst, line_total_inc_gst, sort)";

export type InstallerQuote = InstallerQuoteFacts & { applies: boolean; quote: any | null; channel: string | null };

const NONE = (channel: string | null): InstallerQuote => ({ applies: false, quote: null, channel, sent: false, accepted: false, declined: false, held: false, formCompleted: false });

/** Latest Ready Check installation quote on the job (draft, sent, accepted or declined) and its plain status. */
export async function loadInstallerQuote(jobId: string): Promise<InstallerQuote> {
  const [{ data: job }, { data: qs, error }, { data: m }, { data: basics, error: be }] = await Promise.all([
    admin.from("jobs").select("channel").eq("id", jobId).maybeSingle(),
    admin.from("quotes").select(QUOTE_COLS).eq("job_id", jobId).eq("kind", "installation").in("status", ["draft", "issued", "accepted", "declined"]).order("created_at", { ascending: false }).limit(1),
    admin.from("ceiling_measurements").select("external_source,external_id").eq("job_id", jobId).eq("is_current", true).maybeSingle(),
    admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", "ready_check_basics").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || be) throw new WorkflowError("Quote could not be read.");
  const q = qs?.[0] ?? null;
  const channel = job?.channel ?? null;
  if (!q || !isReadyCheckQuote(q.option_code, m)) return NONE(channel);
  const lines = [...(q.quote_items ?? [])].sort((a, b) => a.sort - b.sort);
  let held = false;
  if (!q.sent_at) {
    const { count, error: he } = await admin.from("workflow_events").select("id", { count: "exact", head: true }).eq("job_id", jobId).eq("event_type", "quote_auto_send_held").contains("details", { quote_id: q.id });
    if (he) throw new WorkflowError("Quote hold could not be checked.");
    held = !!count;
  }
  return {
    applies: true, quote: { ...q, quote_items: lines }, channel,
    sent: !!q.sent_at, accepted: q.status === "accepted", declined: q.status === "declined", held,
    formCompleted: (basics?.details as { completed?: boolean } | null)?.completed === true,
  };
}
