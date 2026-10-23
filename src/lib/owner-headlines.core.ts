/** Jo-approved owner headlines (5 Oct 2026). Rebate = the owner's real rebate. Government mentioned only on the quote. */
export type OwnerHeadlineStep = "spot_saved" | "ready_check_booked" | "quote_ready" | "booking_visits" | "install_booked" | "all_done";

const aud = (n: number) => `$${Math.floor(Math.max(0, n)).toLocaleString("en-AU")}`;

export function ownerHeadline(step: OwnerHeadlineStep, rebate: number): string {
  const r = aud(rebate);
  switch (step) {
    case "spot_saved": return `Spot saved. Your ${r} rebate is waiting.`;
    case "ready_check_booked": return "Booked in! Next stop: your exact price";
    case "quote_ready": return Number.isFinite(rebate) && rebate > 0 ? `You could save ${r} on ceiling insulation` : "Your ceiling insulation quote";
    case "booking_visits": return "Two quick visits. Lower bills for years.";
    case "install_booked": return "Your rebate's locked in. Your installer's booked.";
    case "all_done": return `${r} saved. Bills down. Job done.`;
  }
}

/** Quote screen kicker carries a closing full stop; My job hero does not. */
export const quoteKicker = (rebate: number) => `${ownerHeadline("quote_ready", rebate)}.`;

/** Typical rebate comes from settings; rounded down to the nearest $100. */
export function referralCopy(typicalRebate: number) {
  const rounded = Math.floor(Math.max(0, typicalRebate) / 100) * 100;
  return {
    headline: `Your mates are leaving ${aud(rounded)} on the table`,
    body: "Send a mate your link. They can see their savings in 30 seconds.",
  };
}
