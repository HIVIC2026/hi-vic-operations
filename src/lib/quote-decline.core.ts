// Jo 24 Oct 2026: owners can say "Not for me" to a quote on their secure link (no code needed). Pure wording/rules.
export const DECLINE_REASONS = [
  { key: "price", label: "The price" },
  { key: "timing", label: "Not the right time" },
  { key: "changed_mind", label: "I've changed my mind" },
  { key: "other", label: "Something else" },
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number]["key"];
export const declineReasonLabel = (k: string | null | undefined) => DECLINE_REASONS.find((r) => r.key === k)?.label ?? null;
/** Stored reason text: the chosen label plus the owner's own words, if any. */
export function declineReasonText(key: DeclineReason | null | undefined, note: string | null | undefined): string | null {
  const parts = [declineReasonLabel(key), note?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(": ").slice(0, 1000) : null;
}
export const OWNER_DECLINED_SCREEN = "Thanks for letting us know this quote isn't for you. If you change your mind, just reply to our email and we'll send it again.";
export const OWNER_DECLINED_LINE = "Waiting on office: the owner declined the quote";
export const QUOTE_DECLINED_REOPENED = "Reopened by the office after the owner declined";
