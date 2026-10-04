import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { sha256Hex } from "./assignment.core";
import { quoteTimerAction } from "./quote-expiry.core";

/** Timer sweep: expire 14-day-old installation quotes and queue day-3/day-10 owner nudges.
 * Never changes job stage, never adds to the needs-attention list, never sends (outbox stays unreleased). */
export async function sweepQuoteExpiry(now: Date = new Date()) {
  const { data: rows, error } = await admin.from("quotes")
    .select("id, job_id, kind, status, sent_at, nudge_day3_at, nudge_day10_at")
    .eq("kind", "installation").eq("status", "issued").not("sent_at", "is", null).limit(500);
  if (error) throw new Error(error.message);
  let expired = 0, nudges = 0;
  const iso = now.toISOString();
  for (const q of rows ?? []) {
    const act = quoteTimerAction(q, now);
    if (!act) continue;
    if (act === "expire") {
      const { data: u } = await admin.from("quotes").update({ status: "expired", expired_at: iso }).eq("id", q.id).eq("status", "issued").select("id").maybeSingle();
      if (u) {
        await logEvent(q.job_id, null, "quote_expired", "Installation quote expired: not accepted within 14 days", { quote_id: q.id }, { internal: true });
        expired++;
      }
      continue;
    }
    const col = act === "nudge_day3" ? "nudge_day3_at" : "nudge_day10_at";
    const day = act === "nudge_day3" ? 3 : 10;
    const { data: u } = await admin.from("quotes").update({ [col]: iso } as never).eq("id", q.id).eq("status", "issued").is(col, null).select("id").maybeSingle();
    if (!u) continue;
    await logEvent(q.job_id, null, "quote_nudge", `Day ${day} reminder to owner about their quote (prepared; delivery follows the sending switches)`, { quote_id: q.id, day }, { internal: true });
    const { data: ev } = await admin.from("workflow_events").select("id").eq("job_id", q.job_id).eq("event_type", "quote_nudge").contains("details", { quote_id: q.id, day }).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (ev) {
      const { error: e } = await admin.rpc("enqueue_external_action", {
        _job: q.job_id, _event: ev.id, _action: "customer_email", _target: `quote:${q.id}`, _basis: "transactional_quote_reminder",
        _version: `quote-nudge-day${day}-v1`, _payload: `quote:${q.id}`, _facts: await sha256Hex(`${q.id}-day${day}`), _key: `quote-nudge-${q.id}-day${day}`,
      });
      if (e) console.error("quote nudge outbox enqueue skipped", e.message); // e.g. TEST job suppression
    }
    nudges++;
  }
  return { expired, nudges };
}
