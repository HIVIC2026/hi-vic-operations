// "Pause all trade messages" (Jo 30 Oct 2026): one office switch, `workflow_settings.trade_messages_paused`
// (pending docs/pending-migrations/trade-messages-paused.sql, default ON). While ON no text or email goes to installers,
// electricians, applicants or their teams; owner messages, office alerts and sign-in codes are untouched. Pure.
// A paused send is HELD like every other hold (never claims a once-only key). The column missing (SQL not live yet)
// means NOT paused, so deploying the code before the SQL changes nothing.
import { TEST_ALLOWLIST } from "./test-send.core";

export const TRADE_MESSAGES_PAUSED_REASON = "Trade messages paused";
export const TRADE_PAUSE_COLUMN = "trade_messages_paused";

export type TradePauseSettings = { trade_messages_paused?: boolean | null } | null | undefined;

/** The hold reason while the switch is on; null when off, unknown or not there yet. */
export function tradeMessagesPausedReason(settings: TradePauseSettings): string | null {
  return settings?.trade_messages_paused === true ? TRADE_MESSAGES_PAUSED_REASON : null;
}

type ReadError = { code?: string | null; message?: string | null } | null | undefined;

/** The read failed only because the column is not there yet (SQL not live). */
export function isMissingPauseColumn(error: ReadError): boolean {
  if (!error) return false;
  const msg = String(error.message ?? "");
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return msg.includes(TRADE_PAUSE_COLUMN) && /does not exist|could not find/i.test(msg);
}

/** One settings read → hold reason + a warning to log. Missing column = not paused; any other failure fails closed. */
export function readTradePause(r: { data: TradePauseSettings; error: ReadError }): { reason: string | null; warning: string | null } {
  if (r.error) {
    if (isMissingPauseColumn(r.error)) return { reason: null, warning: `${TRADE_PAUSE_COLUMN} column not found (SQL not live yet) — trade messages treated as NOT paused` };
    return { reason: `${TRADE_MESSAGES_PAUSED_REASON} (the switch could not be read)`, warning: `Could not read ${TRADE_PAUSE_COLUMN}: ${r.error.message ?? "unknown error"} — trade message held` };
  }
  return { reason: tradeMessagesPausedReason(r.data), warning: null };
}

/** A sender's result detail is the trade-pause hold (so the caller must not record its once-only claim). */
export const isTradePauseHold = (detail: string | null | undefined) => String(detail ?? "").startsWith(TRADE_MESSAGES_PAUSED_REASON);

/** The office/partner email sender: partner and applicant emails are trade emails; Jo's allowlisted TEST inbox is not. */
export function tradeEmailPauseReason(x: { recipient: "applicant" | "partner" | "homeowner"; to: string | null | undefined; paused: string | null }): string | null {
  if (!x.paused || x.recipient === "homeowner") return null;
  const to = String(x.to ?? "").trim().toLowerCase();
  if ((TEST_ALLOWLIST.email as readonly string[]).includes(to)) return null;
  return x.paused;
}

/** Jo 31 Oct 2026: one named business may still get trade messages while the pause is on
 *  (`businesses.messages_while_paused`, set by the office only). Only an exact `true` lifts the hold; unknown keeps it. */
export function businessPauseException(paused: string | null, messagesWhilePaused: boolean | null | undefined): string | null {
  return pauseLiftedByAny(paused, [messagesWhilePaused]);
}

/** Same rule across several related businesses: any one flagged exactly `true` lifts the hold; none (or unknown) keeps it. */
export function pauseLiftedByAny(paused: string | null, flags: readonly (boolean | null | undefined)[]): string | null {
  return paused && flags.some((f) => f === true) ? null : paused;
}

// ---- Deep first-job Part 1 (5 Nov 2026): the per-business lift, as pure rules the server reads facts for ------------
// `businessId` is always the RECIPIENT's business (every trade text and email passes it, plus the job). An electrician
// actively linked to a flagged installer counts as that installer's business (Peter → Reinsulate). While the global
// pause is off nothing here runs, so behaviour is unchanged until Jo switches the pause on.

export type PauseLift = "lift" | "hold" | "check_job";

/** Only a paused send with at least one id can be lifted; otherwise the global answer stands and nothing is read. */
export function pauseLiftWanted(paused: string | null, opts: { businessId?: string | null; jobId?: string | null } | undefined): boolean {
  return !!paused && !!(opts?.businessId || opts?.jobId);
}

/** Recipient business known. `flagged` = ids among the recipient AND its linked installers whose flag is exactly true
 *  (null = a read failed → hold). Flagged itself → lift. Nobody flagged → hold. A linked installer flagged: with no job
 *  → lift; with a job → `check_job` (lift only if that installer is on the job, `jobPauseLift`). */
export function recipientPauseLift(f: { recipientId: string; flagged: ReadonlySet<string> | null; jobId: string | null }): PauseLift {
  if (!f.flagged) return "hold";
  if (f.flagged.has(f.recipientId)) return "lift";
  if (!f.flagged.size) return "hold";
  return f.jobId ? "check_job" : "lift";
}

/** Lift when a flagged business is on the job (its originating installer or an active assignee); a failed read holds. */
export function jobPauseLift(flagged: ReadonlySet<string> | null, onJob: ReadonlySet<string> | null): PauseLift {
  if (!flagged || !onJob) return "hold";
  return [...flagged].some((id) => onJob.has(id)) ? "lift" : "hold";
}
