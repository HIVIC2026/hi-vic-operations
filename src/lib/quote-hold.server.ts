// Stage 6 (Jo 22 Oct 2026): the 15-minute office window on an automatically prepared owner quote.
// Arming records WHEN a queued quote may go and writes nothing else; the ONLY release path stays
// releaseQueuedQuotes() in quotes.server.ts, which re-checks the launch switches, consent, intake
// readiness and electrical billing every time. "Stop this quote" is a permanent office decision:
// the quote goes back to held and never auto-sends.
import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { quoteHoldDecision, quoteHoldUntil, QUOTE_HOLD_MINUTES } from "./quote-hold.core";

export const HOLD_STARTED = "quote_hold_started";
export const HOLD_STOPPED = "quote_hold_stopped";

/** One arm per quote: re-arming an already-held quote never restarts the office's window. */
export async function armQuoteHold(jobId: string, actorId: string | null, quoteId: string, startedAtIso: string) {
  const { data: existing } = await admin.from("workflow_events").select("id").eq("job_id", jobId).eq("event_type", HOLD_STARTED)
    .contains("details", { quote_id: quoteId }).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing) return false;
  const holdUntil = quoteHoldUntil(startedAtIso, QUOTE_HOLD_MINUTES);
  await logEvent(jobId, actorId, HOLD_STARTED, `Owner quote held for ${QUOTE_HOLD_MINUTES} minutes — the office can still stop it`, { quote_id: quoteId, hold_until: holdUntil }, { internal: true });
  return true;
}

/** The office stops an auto-send. The quote returns to held with the reason kept permanently. */
export async function stopQuoteHold(jobId: string, actorId: string, quoteId: string, reason: string) {
  const { data: q } = await admin.from("quotes").select("id, status, release_state").eq("id", quoteId).eq("job_id", jobId).maybeSingle();
  if (!q) throw new Error("Quote not found.");
  if (q.release_state === "released" || q.status === "accepted") throw new Error("This quote has already gone to the owner — it can't be stopped.");
  const { error } = await admin.from("quotes").update({ status: "draft", release_state: "held", release_hold_reason: `Stopped by the office: ${reason}`, sent_at: null })
    .eq("id", quoteId).eq("job_id", jobId).in("status", ["draft", "issued"]).neq("release_state", "released");
  if (error) throw new Error(error.message);
  await logEvent(jobId, actorId, HOLD_STOPPED, `Office stopped the auto-send — the quote stays held: ${reason}`, { quote_id: quoteId, reason }, { internal: true });
}

type HoldEvent = { event_type: string; details: { quote_id?: string; hold_until?: string } | null; created_at: string };

/** Current hold state of every quote armed in the last 2 days (one bounded read, never one per quote). */
export async function quoteHolds(lookbackDays = 2): Promise<Map<string, { holdUntil: string | null; stopped: boolean }>> {
  const since = new Date(Date.now() - lookbackDays * 86_400_000).toISOString();
  const { data, error } = await admin.from("workflow_events").select("event_type, details, created_at")
    .in("event_type", [HOLD_STARTED, HOLD_STOPPED]).gte("created_at", since).order("created_at", { ascending: true });
  if (error) throw new Error("Quote holds could not be checked."); // fail closed: an unreadable hold list must never auto-send
  const out = new Map<string, { holdUntil: string | null; stopped: boolean }>();
  for (const e of (data ?? []) as HoldEvent[]) {
    const id = e.details?.quote_id;
    if (!id) continue;
    const cur = out.get(id) ?? { holdUntil: null, stopped: false };
    if (e.event_type === HOLD_STOPPED) cur.stopped = true;
    else cur.holdUntil = e.details?.holdUntil ?? e.details?.hold_until ?? null;
    out.set(id, cur);
  }
  return out;
}

/** Is this quote still inside its office window (or stopped)? True = must not go to the owner yet. */
export async function quoteOnHold(quoteId: string, nowIso: string): Promise<boolean> {
  const holds = await quoteHolds();
  const h = holds.get(quoteId);
  if (!h) return false;
  return quoteHoldDecision({ nowIso, autoSendAtIso: h.holdUntil, stoppedAtIso: h.stopped ? "stopped" : null }) !== "release";
}
