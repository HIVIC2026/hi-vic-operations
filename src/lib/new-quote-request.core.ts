// Batch 3a Task 2: the owner's "Send me a new quote" (O78's button → My job `?screen=newquote`). PURE rules only;
// I/O lives in new-quote-request.server.ts. Wording: the thanks line is approved by Jo (29 Oct 2026, spec section 2);
// every other line here is office-only.
import { QUOTE_EXPIRED_CANCELLED_EVENT, QUOTE_EXPIRED_CANCEL_REASON, QUOTE_EXPIRED_CLOSED_EVENT } from "./quote-expiry.core";

/** One claim per expired quote (details.idempotency_key = the expired quote's id). */
export const NEW_QUOTE_REQUESTED_EVENT = "new_quote_requested";
/** The installer could not be put back on the job (details.lead = "ours" | "installer"): one Needs me row until an
 *  installation quote is created after it. */
export const NEW_QUOTE_NEEDS_INSTALLER_EVENT = "new_quote_needs_installer";
/** The reopen half-finished (a write after the stage move failed): one Needs me row with the reason, until an
 *  installation quote is created after it. Office-only. */
export const NEW_QUOTE_UNFINISHED_EVENT = "new_quote_unfinished";
/** The stage the job reopens to (never via reopenStageFor, which maps this stage back to choose installer). */
export const NEW_QUOTE_STAGE = "measured_estimate_ready";
/** Approved owner page line (Jo, 29 Oct 2026). */
export const NEW_QUOTE_THANKS = "Thanks — we're preparing your new quote and will email it to you.";
/** Office-only. */
export const NEW_QUOTE_CHOOSE_INSTALLER_LINE = "New quote asked for — choose installer";
export const NEW_QUOTE_INSTALLER_INACTIVE_LINE = "New quote asked for — installer no longer active";
/** Office-only prefix of the one Needs me note when the reopen half-finished (Needs me). */
export const NEW_QUOTE_UNFINISHED_PREFIX = "New quote asked for, but it could not be finished — do it by hand";
export const NEW_QUOTE_HOLD_REASON = "New quote asked for by the owner after the last one expired — check it and press Send";

export type NewQuoteEventRow = { event_type: string; created_at: string; details?: Record<string, unknown> | null; to_stage?: string | null };
export type NewQuoteResult = { kind: "thanks" } | { kind: "refused" };

const quoteIdOf = (e: NewQuoteEventRow) => (typeof e.details?.["quote_id"] === "string" ? String(e.details["quote_id"]) : null);

/** The expired quote whose close this request answers: the newest expiry-cancel marker, or (marker write failed) the newest
 *  plain `quote_expired_closed` (not a superseded / not-needed / abandoned note). Null = no expiry close on this job. */
export function expiredQuoteClose(events: readonly NewQuoteEventRow[]): { quoteId: string; at: string } | null {
  const hits = events.filter((e) => {
    if (!quoteIdOf(e)) return false;
    if (e.event_type === QUOTE_EXPIRED_CANCELLED_EVENT) return true;
    const d = e.details ?? {};
    return e.event_type === QUOTE_EXPIRED_CLOSED_EVENT && !d["superseded_by_office"] && !d["not_needed"] && !d["abandoned"];
  });
  const last = [...hits].sort((a, b) => a.created_at.localeCompare(b.created_at)).pop();
  return last ? { quoteId: quoteIdOf(last)!, at: last.created_at } : null;
}

/** The claim for this expired quote already exists (a second tap). */
export function newQuoteAlreadyRequested(events: readonly NewQuoteEventRow[], quoteId: string): boolean {
  return events.some((e) => e.event_type === NEW_QUOTE_REQUESTED_EVENT && (e.details?.["idempotency_key"] === quoteId || quoteIdOf(e) === quoteId));
}

export type NewQuoteFacts = { stage: string | null; cancelledReason: string | null; events: readonly NewQuoteEventRow[] };

/** Null = the job may reopen for a new quote. Allowed only while the job is still closed by the expired quote and was not
 *  reopened (and closed again) since. Office-only text. */
export function newQuoteRequestBlocker(f: NewQuoteFacts): string | null {
  const close = expiredQuoteClose(f.events);
  if (!close) return "No expired quote closed this job.";
  if (f.stage !== "cancelled" || f.cancelledReason !== QUOTE_EXPIRED_CANCEL_REASON) return "The job is no longer closed by its expired quote.";
  // Reopened and cancelled again after the expiry close (same reason text): the expiry close is no longer the current one.
  const lastCancel = f.events.filter((e) => e.event_type === "stage_changed" && e.to_stage === "cancelled").map((e) => e.created_at).sort().pop();
  const lastReopen = f.events.filter((e) => e.event_type === "stage_changed" && e.to_stage && e.to_stage !== "cancelled").map((e) => e.created_at).sort().pop();
  if (lastReopen && lastReopen > close.at) return "The job was reopened after the quote expired.";
  if (lastCancel && lastCancel > close.at) return "The job was closed again after the quote expired.";
  return null;
}

export type NewQuoteLead = "ours" | "installer";
export type NewQuoteOfficeFact = { at: string; kind: "new_quote_installer" | "new_quote_unfinished"; line: string };

/** Needs me: the newest "installer not back" / "could not be finished" note, until an installation quote is created after
 *  it (an installer merely becoming active does not clear it — the quote still has to be made). */
export function newQuoteOfficeFact(events: readonly NewQuoteEventRow[], now: { quoteCreatedAts: readonly string[] }): NewQuoteOfficeFact | null {
  const raised = events.filter((e) => e.event_type === NEW_QUOTE_NEEDS_INSTALLER_EVENT || e.event_type === NEW_QUOTE_UNFINISHED_EVENT)
    .sort((a, b) => a.created_at.localeCompare(b.created_at)).pop();
  if (!raised) return null;
  if (now.quoteCreatedAts.some((at) => at > raised.created_at)) return null;
  if (raised.event_type === NEW_QUOTE_UNFINISHED_EVENT) {
    const why = typeof raised.details?.["reason"] === "string" ? String(raised.details["reason"]) : "";
    return { at: raised.created_at, kind: "new_quote_unfinished", line: why ? `${NEW_QUOTE_UNFINISHED_PREFIX} (${why})` : NEW_QUOTE_UNFINISHED_PREFIX };
  }
  return { at: raised.created_at, kind: "new_quote_installer", line: raised.details?.["lead"] === "installer" ? NEW_QUOTE_INSTALLER_INACTIVE_LINE : NEW_QUOTE_CHOOSE_INSTALLER_LINE };
}

/** Whether the next HIV installation quote answers an owner's new-quote request: a request exists and no installation
 *  quote has been SENT since it. Then the builder (whoever calls it) leaves out accepted fixes lines and holds the quote
 *  for office Send. */
export function newQuoteRebuildPending(requestedAts: readonly string[], sentAts: readonly (string | null)[]): boolean {
  const last = [...requestedAts].sort().pop();
  if (!last) return false;
  return !sentAts.some((s) => !!s && s > last);
}

/** The installer assignment ended by the expiry cancel (`end_reason` "Job cancelled: Quote expired…"), newest first. */
export const EXPIRY_CANCEL_END_REASON_PREFIX = `Job cancelled: ${QUOTE_EXPIRED_CANCEL_REASON.split(" (")[0]}`;
