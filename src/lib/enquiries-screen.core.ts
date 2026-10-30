// Enquiries screen: one Close action (Jo 30 Oct 2026). The reason picks where the enquiry is filed: Duplicate, Junk / spam
// and Test are removed (Jobs › Closed › Removed / test); any other reason is a normal close (Jobs › Closed). History is kept.
export const CLOSE_REASONS: readonly string[] = ["No response", "Owner changed mind", "Not eligible", "Owner opted out", "Duplicate", "Junk / spam", "Test"];

const REMOVE_REASONS = ["Duplicate", "Junk / spam", "Test"];
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

// Exact match only, after trim, single spaces and lower-case: "Duplicate address, owner moved" is a normal close.
export function closeRouteFor(reason: string): "remove" | "cancel" {
  return REMOVE_REASONS.some((r) => norm(r) === norm(reason)) ? "remove" : "cancel";
}

/** The reason saved on a removed lead: the preset's own wording ("junk  /  SPAM" → "Junk / spam"); anything else as typed. */
export function removeReasonText(reason: string): string {
  return REMOVE_REASONS.find((r) => norm(r) === norm(reason)) ?? reason;
}

/** Only website enquiries can go to Removed / test; the server skips the rest and says how many it removed. */
export function removeOutcomeToast(asked: number, removed: number): { ok: boolean; text: string } {
  if (removed >= asked) return { ok: true, text: `${removed} removed` };
  return { ok: false, text: `${removed} closed; ${asked - removed} not: only website enquiries can go to Removed / test — close them with another reason` };
}

/** Ticks to keep after a partial remove: drop the ones that were on the page and have now gone from it (removed);
 *  keep the rest, including ticks from other pages we can't see. */
export function keepTicked(picked: Iterable<string>, pageBefore: Iterable<string>, pageAfter: Iterable<string>): Set<string> {
  const before = new Set(pageBefore), after = new Set(pageAfter);
  return new Set([...picked].filter((id) => !before.has(id) || after.has(id)));
}

// Count line under the tabs: "48 enquiries · updated 5 min ago" (the "updated" part only when we know when the list was last checked).
export function enquiryCountLine(total: number, checked: string | null): string {
  const base = `${total.toLocaleString("en-AU")} ${total === 1 ? "enquiry" : "enquiries"}`;
  return checked ? `${base} · updated ${checked}` : base;
}
