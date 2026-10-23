import { AUTO_QUOTE_SEND_ENABLED } from "./auto-quote-send.core";
/** Quote policy. Drafting alone never authorises delivery. Jo 24 Oct: a Ready Check quote (installer's own job A1 or
 *  our lead A2) goes out automatically when the installer marks the Mitti form Complete and every check passes. */
export const automaticQuoteSendingAllowed = (_form: "A1" | "A2" = "A2") => AUTO_QUOTE_SEND_ENABLED;
export function quoteReviewReasons(stored: string | null | undefined, latest: { at: string; reasons: string[] } | null, quoteAt: string | null) {
  const reasons = (stored ?? "").split(" · ").map(s => s.trim()).filter(s => s && s !== "Waiting for office review before sending" && s !== "Waiting for installer reapproval after office adjustment");
  if (latest && (!quoteAt || latest.at > quoteAt)) reasons.push(...latest.reasons);
  return [...new Set(reasons)];
}
export function quoteNeedsOfficeReview(q: { status: string; sent_at?: string | null; release_state?: string | null }) {
  return q.status === "draft" || (q.status === "issued" && !q.sent_at && q.release_state !== "released");
}