// Enquiries screen: one Close action (Jo 30 Oct 2026). The reason picks where the enquiry is filed: Duplicate, Junk / spam
// and Test are removed (Jobs › Closed › Removed / test); any other reason is a normal close (Jobs › Closed). History is kept.
export const CLOSE_REASONS: readonly string[] = ["No response", "Owner changed mind", "Not eligible", "Owner opted out", "Duplicate", "Junk / spam", "Test"];

const REMOVE_REASONS = ["duplicate", "junk / spam", "test"];

// Exact match only, after trim and lower-case: "Duplicate address, owner moved" is a normal close.
export function closeRouteFor(reason: string): "remove" | "cancel" {
  return REMOVE_REASONS.includes(reason.trim().toLowerCase()) ? "remove" : "cancel";
}
