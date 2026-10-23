// Jo 23 Oct 2026: owner "No longer interested" reasons. Job moves to the existing Closed (cancelled) stage with this reason.
export const NOT_INTERESTED_REASONS = [
  { value: "already_insulated", label: "Already insulated" },
  { value: "price_too_high", label: "Price too high" },
  { value: "selling_moving", label: "Selling or moving" },
  { value: "changed_mind", label: "Changed my mind" },
  { value: "other", label: "Other" },
] as const;
export type NotInterestedReason = (typeof NOT_INTERESTED_REASONS)[number]["value"];
export const NOT_INTERESTED_THANKS = "Thanks for letting us know. We've closed your enquiry and won't contact you about it again. If anything changes, just reply to any of our emails and we'll be happy to help.";

/** Reason stored on the closed job. No reason (old opt-out link) keeps the original wording. */
export function notInterestedText(reason?: NotInterestedReason, note?: string): string {
  if (!reason) return "Owner opted out";
  const label = NOT_INTERESTED_REASONS.find((r) => r.value === reason)!.label;
  const n = note?.trim();
  return `Owner no longer interested: ${label}${n ? ` — ${n.slice(0, 500)}` : ""}`;
}
