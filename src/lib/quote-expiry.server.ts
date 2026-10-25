import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { quoteTimerAction } from "./quote-expiry.core";

/** Timer sweep: expire 14-day-old installation quotes and record the day-3/day-10 points (record only).
 * Never changes job stage, never adds to the needs-attention list, never sends. */
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
    // F13: record only. The owner's quote reminders are the approved email + text (decisions 88/89: 3 days after the quote
    // and 2 days before the price expires — owner-email-triggers / approved-texts); the old outbox row here was never sendable.
    await logEvent(q.job_id, null, "quote_nudge", `Day ${day} since the quote (record only — the owner's reminders are the approved quote reminder email and text)`, { quote_id: q.id, day }, { internal: true });
    nudges++;
  }
  return { expired, nudges };
}
