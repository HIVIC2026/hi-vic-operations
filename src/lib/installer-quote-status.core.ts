// Jo 24 Oct 2026: installers no longer approve owner quotes — installer jobs (A1, INSTALLER_A1) and our leads
// (A2, R5/R6/R7_BATTS) alike. The installer presses Complete in the Mitti Ready Check, the quote is prepared
// automatically and the office presses Send. Old installer quote approval events stay as history and are no
// longer read or written. Pure presentation only — never a send, release or readiness decision.

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

/** Decision 303: the quote is held because the installer's electrician is not an approved REC yet. */
export const QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE = "Your electrician needs to finish onboarding before the quote goes out";

export type InstallerQuoteFacts = {
  sent: boolean; accepted: boolean; declined: boolean;
  /** A check held the quote for the office (quote_auto_send_held for this quote). */ held: boolean;
  /** The installer has marked the Mitti Ready Check Complete (latest ready_check_basics). */ formCompleted?: boolean;
  /** Decision 303: held "Electrician not onboarded: <name>" (quote hold reason / latest installer_quote_held). */ electricianNotOnboarded?: boolean;
};

/** One line for the installer's job card: prepared / held / sent / accepted / declined. No approve step. */
export function installerQuoteLine(f: InstallerQuoteFacts): string {
  if (f.declined) return QUOTE_DECLINED_LINE;
  if (f.accepted) return QUOTE_ACCEPTED_LINE;
  if (f.sent) return QUOTE_SENT_LINE;
  if (f.electricianNotOnboarded) return QUOTE_ELECTRICIAN_NOT_ONBOARDED_LINE;
  if (f.held || f.formCompleted) return QUOTE_HELD_LINE;
  return PRESS_COMPLETE_LINE;
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
