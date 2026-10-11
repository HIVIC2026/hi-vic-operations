// Which installation quotes an owner may see and act on (pure). Source of truth: "While either the quote or
// customer-communications launch switch is off, an otherwise releasable quote remains queued and nothing goes to the
// owner." Held and queued quotes are office-only; null release_state marks legacy quotes (pre-0114), which stay visible.
export type OwnerQuoteLike = { status: string; release_state?: string | null };

export function ownerQuoteReleased(q: OwnerQuoteLike): boolean {
  return q.release_state == null || q.release_state === "released";
}

/** Quotes for the owner's My job view: accepted/declined/expired history stays; issued quotes only once released. */
export function ownerVisibleQuotes<T extends OwnerQuoteLike>(quotes: T[]): T[] {
  return quotes.filter((q) => q.status !== "issued" || ownerQuoteReleased(q));
}

/** Owner portal Quotes panel (/owner/$jobId): never drafts; issued quotes only once released — same rule as My job. */
export function ownerPanelQuotes<T extends OwnerQuoteLike>(quotes: T[]): T[] {
  return ownerVisibleQuotes(quotes.filter((q) => q.status !== "draft"));
}

export const QUOTE_NOT_RELEASED = "This quote hasn't been released to you yet. Home Insulation Victoria will let you know when it's ready.";
export const QUOTE_CHANGED_WHILE_ACCEPTING = "This quote changed while you were accepting it. Please refresh to see the current quote.";
