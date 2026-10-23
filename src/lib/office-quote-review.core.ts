/** Office-only quote policy. Drafting never authorises delivery, regardless of timers or switches. */
export const automaticQuoteSendingAllowed = () => false;
export function quoteReviewReasons(stored: string | null | undefined, latest: { at: string; reasons: string[] } | null, quoteAt: string | null) {
  const reasons = (stored ?? "").split(" · ").map(s => s.trim()).filter(s => s && s !== "Waiting for office review before sending" && s !== "Waiting for installer reapproval after office adjustment");
  if (latest && (!quoteAt || latest.at > quoteAt)) reasons.push(...latest.reasons);
  return [...new Set(reasons)];
}
export function quoteNeedsOfficeReview(q: { status: string; sent_at?: string | null; release_state?: string | null }) {
  return q.status === "draft" || (q.status === "issued" && !q.sent_at && q.release_state !== "released");
}