import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { QUOTE_CLOSE_RETRY_DAYS, QUOTE_EXPIRED_BLOCKED_EVENT, QUOTE_EXPIRED_CANCELLED_EVENT, QUOTE_EXPIRED_CANCEL_REASON, QUOTE_EXPIRED_CLOSED_EVENT, quoteCloseQuietReason, quoteExpiredBlockedLine, quoteExpiredEmailRetriable, quoteTimerAction, shouldCloseOnExpiry } from "./quote-expiry.core";

/** Timer sweep: expire 14-day-old installation quotes and record the day-3/day-10 points.
 * Batch 3a: when an expired quote leaves the job with no other issued/accepted installation quote, the job is closed
 * ("Quote expired (14 days)", installer told, owner not told by the cancel) and the owner gets the one expired-quote email. */
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
  // Close pass: every recently expired quote whose close + email is not finished (first attempt, night-time wait, failure).
  let closed = 0;
  const since = new Date(now.getTime() - QUOTE_CLOSE_RETRY_DAYS * 86_400_000).toISOString();
  const { data: exp } = await admin.from("quotes").select("id, job_id").eq("kind", "installation").eq("status", "expired").gte("expired_at", since).limit(500);
  const pending = exp ?? [];
  if (pending.length && !quoteCloseQuietReason(iso)) {
    const { data: done } = await admin.from("workflow_events").select("job_id, details").in("job_id", pending.map((p) => p.job_id)).eq("event_type", QUOTE_EXPIRED_CLOSED_EVENT);
    const doneQuotes = new Set((done ?? []).map((e) => String((e.details as { quote_id?: string } | null)?.quote_id)));
    for (const q of pending) if (!doneQuotes.has(q.id) && (await closeOnExpiry(q.job_id, q.id))) closed++;
  }
  return { expired, nudges, closed };
}

/** Close the job and email the owner once for one expired quote. Safe to run again: true = closed and emailed. Never throws. */
async function closeOnExpiry(jobId: string, quoteId: string): Promise<boolean> {
  try {
    const [{ data: job }, { data: others }, { data: mine }] = await Promise.all([
      admin.from("jobs").select("stage").eq("id", jobId).maybeSingle(),
      admin.from("quotes").select("status").eq("job_id", jobId).eq("kind", "installation").neq("id", quoteId),
      admin.from("workflow_events").select("details").eq("job_id", jobId).eq("event_type", QUOTE_EXPIRED_CANCELLED_EVENT),
    ]);
    const cancelledByUs = (mine ?? []).some((e) => (e.details as { quote_id?: string } | null)?.quote_id === quoteId);
    if (job?.stage === "cancelled" && cancelledByUs) {
      // The close happened on an earlier run; only the email is left.
    } else {
      if (!shouldCloseOnExpiry(job?.stage, (others ?? []).map((o) => String(o.status)))) return false;
      const { quoteExpiredDeliverable } = await import("./quote-expired-email.server");
      const d = await quoteExpiredDeliverable(jobId);
      if (!d.ok) {
        const { data: ev } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [QUOTE_EXPIRED_BLOCKED_EVENT, QUOTE_EXPIRED_CLOSED_EVENT]);
        const { quoteExpiredBlockedFact } = await import("./office-needs.core");
        const open = quoteExpiredBlockedFact((ev ?? []).map((e) => ({ event_type: String(e.event_type), created_at: String(e.created_at), details: (e.details ?? null) as Record<string, unknown> | null })));
        if (!open || open.reason !== d.reason) await logEvent(jobId, null, QUOTE_EXPIRED_BLOCKED_EVENT, `${quoteExpiredBlockedLine(d.reason)} — the job was left open`, { quote_id: quoteId, reason: d.reason, needs_office: true }, { internal: true });
        return false;
      }
      await (await import("./office-actions.server")).cancelJobFully(jobId, QUOTE_EXPIRED_CANCEL_REASON, null, { tell: { owner: false, installer: true } });
      await logEvent(jobId, null, QUOTE_EXPIRED_CANCELLED_EVENT, "Job closed: the installation quote expired", { quote_id: quoteId }, { internal: true });
    }
    const out = await (await import("./quote-expired-email.server")).sendQuoteExpiredEmail(jobId, quoteId);
    if (quoteExpiredEmailRetriable(out)) { await logEvent(jobId, null, "quote_expired_close_failed", `Expired quote email did not go out (will retry): ${out}`, { quote_id: quoteId }, { internal: true }).catch(() => undefined); return false; }
    await logEvent(jobId, null, QUOTE_EXPIRED_CLOSED_EVENT, `Job closed: the installation quote expired. Owner ${out}`, { quote_id: quoteId }, { internal: true });
    return true;
  } catch (e) {
    await logEvent(jobId, null, "quote_expired_close_failed", `The expired quote could not close the job (will retry): ${(e as Error).message}`, { quote_id: quoteId }, { internal: true }).catch(() => undefined);
    return false;
  }
}
