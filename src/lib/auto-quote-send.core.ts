// Jo 24 Oct 2026: the installer does NOT approve the quote. When the installer marks the Mitti Ready Check
// Complete and every check passes, the owner's quote (installer total, which includes any difficult access fee, + PIESA + $349
// AP fee − VEU rebate) goes to the owner automatically. Anything that fails a check is held for the office with the reason.
// A form edited after a quote was sent is flagged for the office; the sent quote is never changed. Pure rules only.

/** Jo 24 Oct: "manual for the first few weeks". Pressing Complete in Mitti prepares everything automatically
 *  (measurements, eligibility from the form, quote stage, quote) — this switch is ON — and the quote then waits on
 *  Quotes to check for the office to press Send. */
export const READY_CHECK_AUTO_PREP_ENABLED = true;
/** The automatic SEND to the owner: OFF for the first few weeks; Jo switches it on later. */
export const AUTO_QUOTE_SEND_ENABLED = false;

// Jo 24 Oct (later): no price-range or access-fee limit on the installer's own jobs ("he can charge what he wants as
// long as our AP fee and the electrician fees are right"). Those lines come from our settings, not from the form.

export const CHANGED_AFTER_SEND = "Ready Check changed after the quote was sent — office to check; the sent quote was not changed";

export type AutoSendDecision = { send: true } | { send: false; reasons: string[]; quiet?: boolean };

/** quiet = nothing for the office to do yet (switch off, form not complete). */
export function autoSendDecision(i: { enabled: boolean; formCompleted: boolean; quoteReady: boolean; blockers: string[]; sentBefore: boolean }): AutoSendDecision {
  if (!i.enabled) return { send: false, reasons: ["Automatic quote sending is switched off"], quiet: true };
  if (!i.formCompleted) return { send: false, reasons: ["Ready Check not marked Complete in Mitti yet"], quiet: true };
  const reasons = [...i.blockers];
  if (i.sentBefore) reasons.unshift(CHANGED_AFTER_SEND);
  if (!i.quoteReady && !reasons.length) reasons.push("Owner quote could not be prepared");
  return reasons.length ? { send: false, reasons: [...new Set(reasons)] } : { send: true };
}
