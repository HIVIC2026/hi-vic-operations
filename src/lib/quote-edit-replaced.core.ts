// Jo 28 Oct 2026: the installer's price always rebuilds the owner quote (INSTALLER_A1). When the draft that rebuild
// replaces had been edited by the office (adjustQuote → quotes.manually_adjusted), the office gets ONE alert per replaced
// draft. The alert never blocks Send, never locks the price card and is never shown to the installer.
export const QUOTE_EDIT_REPLACED_EVENT = "installer_quote_edit_replaced";
export const QUOTE_EDIT_REPLACED_NOTICE = "Installer changed their price — the quote your office edited was rebuilt. Check it before sending.";

/** Puts the alert in front of an office line when the current quote is a rebuild of an office-edited draft. */
export function withEditReplacedNotice(text: string | null, flagged: boolean): string | null {
  if (!flagged) return text;
  return text ? `${QUOTE_EDIT_REPLACED_NOTICE} ${text}` : QUOTE_EDIT_REPLACED_NOTICE;
}
