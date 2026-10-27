// Jo 24 Oct 2026: installers no longer approve owner quotes — installer jobs (A1, INSTALLER_A1) and our leads
// (A2, R5/R6/R7_BATTS) alike. The installer presses Complete in the Mitti Ready Check, the quote is prepared
// automatically and the office presses Send. Old installer quote approval events stay as history and are no
// longer read or written. Pure presentation only — never a send, release or readiness decision.
import { installerNotOnboardedNote, isInstallerNotOnboardedNote } from "./rec-onboarded.core";

export const INSTALLER_A1_CODE = "INSTALLER_A1";
export const A2_RATE_CARD_CODES = ["R5_BATTS", "R6_BATTS", "R7_BATTS"] as const;

/** A Ready Check owner quote: the installer's own job (A1), one of our leads priced from the rate card (A2), or any
 *  quote on a job whose current measurement is a linked Mitti form. */
export function isReadyCheckQuote(optionCode: string | null | undefined, mitti: { external_source?: string | null; external_id?: string | null } | null | undefined): boolean {
  if (optionCode === INSTALLER_A1_CODE || (A2_RATE_CARD_CODES as readonly string[]).includes(optionCode ?? "")) return true;
  return mitti?.external_source === "mitti" && !!mitti.external_id;
}

export const PRESS_COMPLETE_LINE = "You: when the Ready Check is finished, press Complete in Mitti — we then send the owner their quote";
/** Shown while the office checks the quote: after Complete in Mitti, or when a check held it for the office. */
export const QUOTE_HELD_LINE = "Waiting on office: checking the quote";
export const QUOTE_DECLINED_LINE = "Waiting on office: the owner declined the quote";
export const QUOTE_ACCEPTED_LINE = "Waiting on owner: quote accepted – waiting for owner's payment";
export const QUOTE_SENT_LINE = "Waiting on owner: to accept the quote";


export type InstallerQuoteFacts = {
  sent: boolean; accepted: boolean; declined: boolean;
  /** A check held the quote for the office (quote_auto_send_held for this quote). */ held: boolean;
  /** The installer has marked the Mitti Ready Check Complete (latest ready_check_basics). */ formCompleted?: boolean;
  /** Decision 303: held "Electrician not onboarded: <name>" (quote hold reason / latest installer_quote_held); the
   *  electrician's name, or null. */ electricianNotOnboarded?: { name: string } | null;
};

/** One line for the installer's job card: prepared / held / sent / accepted / declined. No approve step. */
export function installerQuoteLine(f: InstallerQuoteFacts): string {
  if (f.declined) return QUOTE_DECLINED_LINE;
  if (f.accepted) return QUOTE_ACCEPTED_LINE;
  if (f.sent) return QUOTE_SENT_LINE;
  // Jo 28 Oct 2026 (spec rule 3): the named note while the electrician hasn't finished signing up.
  if (f.electricianNotOnboarded) return installerNotOnboardedNote(f.electricianNotOnboarded.name);
  if (f.held || f.formCompleted) return QUOTE_HELD_LINE;
  return PRESS_COMPLETE_LINE;
}

/** Jo 28 Oct 2026 (spec rule 3): the short line instead of the not-signed-up note — the business owner's job page Next
 *  panel (the note is on their price card), and everything a crew member sees (the note carries a price). */
export const NOT_ONBOARDED_NEXT_TITLE = "Waiting on your electrician to sign up";

/** Jo 28 Oct 2026 ("The crew shouldn't see the price!!!"): the quote line as this viewer may see it. The business owner
 *  gets the line unchanged; a crew member (`boss` false) gets the short line instead of the not-signed-up note, which
 *  has the $349 price. Every other line has no price and is unchanged. */
export function quoteLineForViewer<T extends string | null | undefined>(line: T, boss: boolean): T | typeof NOT_ONBOARDED_NEXT_TITLE {
  return !boss && isInstallerNotOnboardedNote(line) ? NOT_ONBOARDED_NEXT_TITLE : line;
}

/** The installer job page's quote line and electrician facts for this viewer (trade-view tradeJobPage). The electrician's
 *  name has no price, so it is kept; the line is `quoteLineForViewer`. */
export function installerQuoteView(f: InstallerQuoteFacts, boss: boolean): { line: string; electricianNotOnboarded: { name: string } | null } {
  return { line: quoteLineForViewer(installerQuoteLine(f), boss), electricianNotOnboarded: f.electricianNotOnboarded ?? null };
}

/** Jo 28 Oct 2026 (spec rule 3): the installer's move — a "You:" line, or the not-signed-up note (they ask the
 *  electrician to finish, or switch to ours). Such a job sits under Action needed, never In progress. */
export const quoteLineYours = (line: string | null | undefined): boolean => !!line && (line.startsWith("You:") || isInstallerNotOnboardedNote(line));

/** The installer job list tab (trade-view tradeHome): a done job stays done; a quote line decides Action needed vs In
 *  progress; no quote line keeps the tab from the job's place and stage. */
export function quoteLineTab<T extends string>(tab: T, line: string | null | undefined): T | "action" | "progress" {
  if (tab === "done") return tab;
  return line ? (quoteLineYours(line) ? "action" : "progress") : tab;
}

/** Office Quotes to check: every draft is listed for Check & send; jobs with no draft yet (Ready Check basics
 *  missing, or held before drafting) are listed separately with what is missing. No installer-approval split. */
export function splitQuotesToCheck<T extends { quoteId: string | null }>(rows: T[]): { drafts: T[]; notDrafted: T[] } {
  return { drafts: rows.filter((r) => !!r.quoteId), notDrafted: rows.filter((r) => !r.quoteId) };
}

/** One short grey status for a not-yet-drafted row. */
export function missingStatus(reasons: string[]): string {
  const n = reasons.length;
  return n === 0 ? "Details missing" : `${n} thing${n === 1 ? "" : "s"} missing`;
}
