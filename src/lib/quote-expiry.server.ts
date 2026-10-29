import { supabaseAdmin as admin } from "@/integrations/supabase/client.server";
import { logEvent } from "./workflow.server";
import { QUOTE_CLOSE_RETRY_DAYS, QUOTE_EXPIRED_BLOCKED_EVENT, QUOTE_EXPIRED_CANCELLED_EVENT, QUOTE_EXPIRED_CANCEL_REASON, QUOTE_EXPIRED_CLOSED_EVENT, QUOTE_EXPIRED_HELD_REASON, quoteCloseQuietReason, quoteExpiredBlockedLine, quoteExpiredEmailRetriable, quoteExpiryHeld, quoteTimerAction, shouldCloseOnExpiry } from "./quote-expiry.core";

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
        // close_pending: only quotes expired by this sweep are ever closed/emailed (older expired quotes are left alone).
        await logEvent(q.job_id, null, "quote_expired", "Installation quote expired: not accepted within 14 days", { quote_id: q.id, close_pending: true }, { internal: true });
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
  // Close pass: quotes this sweep expired (close_pending) whose close + email is not finished (first attempt, night wait, failure).
  let closed = 0;
  const day = 86_400_000;
  const { data: marks } = await admin.from("workflow_events").select("job_id, created_at, details").eq("event_type", "quote_expired").contains("details", { close_pending: true }).gte("created_at", new Date(now.getTime() - (QUOTE_CLOSE_RETRY_DAYS + 7) * day).toISOString()).order("created_at", { ascending: true }).limit(1000);
  const pending = (marks ?? []).map((m) => ({ jobId: String(m.job_id), quoteId: String((m.details as { quote_id?: string } | null)?.quote_id), at: String(m.created_at) }));
  const doneQuotes = new Set<string>();
  const jobIds = [...new Set(pending.map((p) => p.jobId))];
  for (let i = 0; i < jobIds.length; i += 100) {
    const { data: done } = await admin.from("workflow_events").select("job_id, details").in("job_id", jobIds.slice(i, i + 100)).eq("event_type", QUOTE_EXPIRED_CLOSED_EVENT);
    for (const e of done ?? []) doneQuotes.add(String((e.details as { quote_id?: string } | null)?.quote_id));
  }
  const windowStart = now.getTime() - QUOTE_CLOSE_RETRY_DAYS * day;
  const quiet = !!quoteCloseQuietReason(iso);
  for (const p of pending) {
    if (doneQuotes.has(p.quoteId)) continue;
    if (Date.parse(p.at) < windowStart) { // fell out of the retry window without closing: stop trying, clear any Needs me row
      await logEvent(p.jobId, null, QUOTE_EXPIRED_CLOSED_EVENT, "The expired quote fell out of the 14-day close window without closing the job", { quote_id: p.quoteId, abandoned: true }, { internal: true }).catch(() => undefined);
      continue;
    }
    if (!quiet && (await closeOnExpiry(p.jobId, p.quoteId))) closed++;
  }
  return { expired, nudges, closed };
}

/** Close the job and email the owner once for one expired quote. Safe to run again: true = closed and emailed. Never throws. */
async function closeOnExpiry(jobId: string, quoteId: string): Promise<boolean> {
  try {
    const [{ data: job }, { data: others }, { data: markers }] = await Promise.all([
      admin.from("jobs").select("stage, cancelled_reason").eq("id", jobId).maybeSingle(),
      admin.from("quotes").select("status").eq("job_id", jobId).eq("kind", "installation").neq("id", quoteId),
      admin.from("workflow_events").select("details, created_at").eq("job_id", jobId).eq("event_type", QUOTE_EXPIRED_CANCELLED_EVENT),
    ]);
    const hasMarker = (markers ?? []).some((e) => (e.details as { quote_id?: string } | null)?.quote_id === quoteId);
    const cancelledByUs = job?.stage === "cancelled" && job.cancelled_reason === QUOTE_EXPIRED_CANCEL_REASON;
    const finish = async (details: Record<string, unknown>, why: string) => { await logEvent(jobId, null, QUOTE_EXPIRED_CLOSED_EVENT, why, { quote_id: quoteId, ...details }, { internal: true }); return false; };
    /** ONE office row per reason (repeats of the same reason while the row is open write nothing). */
    const raiseBlocked = async (reason: string, summary: string) => {
      const { data: ev } = await admin.from("workflow_events").select("event_type, created_at, details").eq("job_id", jobId).in("event_type", [QUOTE_EXPIRED_BLOCKED_EVENT, QUOTE_EXPIRED_CLOSED_EVENT]);
      const { quoteExpiredBlockedFact } = await import("./office-needs.core");
      const open = quoteExpiredBlockedFact((ev ?? []).map((e) => ({ event_type: String(e.event_type), created_at: String(e.created_at), details: (e.details ?? null) as Record<string, unknown> | null })));
      if (!open || open.reason !== reason) await logEvent(jobId, null, QUOTE_EXPIRED_BLOCKED_EVENT, summary, { quote_id: quoteId, reason, needs_office: true }, { internal: true });
      return false;
    };
    if (hasMarker && !cancelledByUs) return finish({ superseded_by_office: true }, "The job was reopened or closed another way after the expired-quote close: nothing more to do");
    const { quoteExpiredDeliverable } = await import("./quote-expired-email.server");
    if (cancelledByUs) {
      // The close happened on an earlier run; only the email is left — unless another expired quote's close made this cancel
      // (two quotes expiring on one job): that close emailed the owner already.
      if (!hasMarker) {
        const { data: cancels } = await admin.from("workflow_events").select("created_at").eq("job_id", jobId).eq("event_type", "stage_changed").eq("to_stage", "cancelled");
        const lastCancel = (cancels ?? []).map((c) => String(c.created_at)).sort().pop() ?? "";
        const otherClosed = (markers ?? []).some((e) => (e.details as { quote_id?: string } | null)?.quote_id !== quoteId && String(e.created_at) >= lastCancel);
        if (otherClosed) return finish({ closed_by_other_quote: true }, "Another expired quote already closed this job and emailed the owner: nothing more to do");
      }
      // Retry: the owner may have become un-emailable since the close (consent withdrawn, messages switched off).
      const d = await quoteExpiredDeliverable(jobId);
      if (!d.ok) return raiseBlocked(d.reason, `${quoteExpiredBlockedLine(d.reason)} — the job is closed, the expired-quote email did not go out`);
    } else {
      if (!shouldCloseOnExpiry(job?.stage, (others ?? []).map((o) => String(o.status)))) return finish({ not_needed: true }, "The expired quote no longer needs to close the job (job already closed, or another quote is open)");
      // The decline auto-close's safety checks: a live booking or money paid (or on hold) → never closed by the timer.
      const [{ data: bk }, { data: inv }] = await Promise.all([
        admin.from("bookings").select("id").eq("job_id", jobId).in("status", ["confirmed", "proposed"]).limit(1),
        admin.from("invoices").select("id").eq("job_id", jobId).gt("total_paid", 0).limit(1),
      ]);
      if (quoteExpiryHeld({ stage: job?.stage, liveBooking: (bk ?? []).length > 0, paid: (inv ?? []).length > 0 })) {
        return raiseBlocked(QUOTE_EXPIRED_HELD_REASON, `${QUOTE_EXPIRED_HELD_REASON} — the job was left open`);
      }
      const d = await quoteExpiredDeliverable(jobId);
      if (!d.ok) return raiseBlocked(d.reason, `${quoteExpiredBlockedLine(d.reason)} — the job was left open`);
      await (await import("./office-actions.server")).cancelJobFully(jobId, QUOTE_EXPIRED_CANCEL_REASON, null, { tell: { owner: false, installer: true } });
      // A failed marker write must not stop the email this run (the job is closed with our reason either way).
      await logEvent(jobId, null, QUOTE_EXPIRED_CANCELLED_EVENT, "Job closed: the installation quote expired", { quote_id: quoteId }, { internal: true }).catch(() => undefined);
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
