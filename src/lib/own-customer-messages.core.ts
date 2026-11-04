// Part 10 Task 8 (Review Focus 5): an installer's OWN customer (channel installer_sourced) never gets a pre-quote owner
// message — no estimate email, Save my spot, It's your turn, "{installer} will call you", estimate reminders or quick taps.
// Their first email from us is the quote. The one exception (Jo 2 Nov 2026, answer 24) is the rental quick-taps TEXT right
// after Add a job (rental-answers.server, OWN_CUSTOMER_RENTAL_TAPS_APPROVED) — a text, so the quote is still the first email.
// Pure: one block list keyed on the channel, used by every pre-quote sender's own gate. No I/O.

export const OWN_CUSTOMER_PRE_QUOTE_BLOCK = "Installer's own customer: the quote is their first message from us";

/** The reason a pre-quote owner message must not go (null = not blocked by this rule). Unknown channel = not blocked. */
export function ownCustomerPreQuoteBlocker(channel: string | null | undefined): string | null {
  return channel === "installer_sourced" ? OWN_CUSTOMER_PRE_QUOTE_BLOCK : null;
}
