// Office-facing quote status label used wherever office staff see quote status.
// Keeps the business distinction: Issued / Queued / Held / Released / Accepted.
// DB status/release_state values and quote-release business logic are unchanged.
export function officeQuoteStatusLabel(q: { status: string; release_state?: string | null }): string {
  if (q.release_state === "held") return "Held";
  if (q.release_state === "queued") return "Queued – ready to send";
  // released and legacy (null) rows show the real status: Issued / Accepted / Declined / Expired…
  return q.status;
}
