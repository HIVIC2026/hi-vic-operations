// Decision 388 (Jo 25 Oct 2026, in capitals: "WE ARE SAVING SPOTS NOT OFFERING READY CHECKS").
// Process, in Jo's words: "We save spots and then I will manually, slowly release one by one to a chosen installer
// while we staff." So, BEFORE an owner's spot is released, nothing they see or receive may offer, promise or describe a
// Ready Check, an installer visit, being offered times, measuring, when the quote comes, or any speed/timeframe
// ("soon", "shortly", "this week", "as soon as", queue-position promises). Allowed: save your spot (free, no
// obligation); thousands of Victorians have registered; spots are released in the order they were saved; we'll be in
// touch when your spot is released. Messages AFTER release (Ready Check times/booking, quote, PIESA, install) are not
// covered. PURE: wording only. Proposed wording awaiting Jo's approval: docs/decision-388-spot-only-wording.md.

/** Jo's own statement of the process (decision 388). */
export const SPOT_PROCESS_STATEMENT = "We save spots and then I will manually, slowly release one by one to a chosen installer while we staff.";

export const SPOT_FREE = "Saving your spot is free, with no obligation.";
export const SPOT_REGISTERED = "Thousands of Victorians have registered.";
export const SPOT_ORDER = "Spots are released in the order they were saved.";
export const SPOT_IN_TOUCH = "We'll be in touch when your spot is released.";
/** The two-sentence line Jo asked for. */
export const SPOT_RELEASE_LINE = `${SPOT_ORDER} ${SPOT_IN_TOUCH}`;
/** Registered + order + in touch, for messages that explain the wait. */
export const SPOT_WAIT_LINE = `${SPOT_REGISTERED} ${SPOT_RELEASE_LINE}`;
/** Price caveat with no Ready Check, no measuring and no quote timing. */
export const SPOT_PRICE_NOTE = "This is an estimate. You'll see your exact price before you agree to anything.";

/** Anything matching this must never appear in pre-release owner copy (tests scan every renderer and constant). */
export const PRE_RELEASE_FORBIDDEN = /ready check|installer (will|visits?|offers?|measures?|checks?)|offer(s|ed)? you( \d)? times|their times|times for your|\bmeasur|on-?site|as soon as|\bsoon\b|shortly|this week|jump the queue|move up|book your|to book\b|speed it up/i;

/** The forbidden phrases found in `text` (empty = spot-only). */
export function preReleaseViolations(text: string): string[] {
  const re = new RegExp(PRE_RELEASE_FORBIDDEN.source, "gi");
  return [...new Set((text.match(re) ?? []).map((m) => m.toLowerCase()))];
}
