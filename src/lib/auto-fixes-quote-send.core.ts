// Decision 354 (Jo 25 Oct 2026): the electrical fixes quote the electrician priced on the A4 PIESA form goes to the
// owner AUTOMATICALLY when the A4 is complete and every existing check passes — no office "Fixes quote to check" step.
// Same checks as the office Send button (`rectificationSendBlocker`: no unpriced items, the decision-315 fixes-times
// hold, a draft), plus the master switch for real owners (`customer_comms_enabled`; TEST jobs go to test-send through
// the same owner email path). A check that fails keeps the Needs me "Electrical fixes quote to check" row, with the reason.
// PURE: no I/O. The reads, the one shared release (fixes-quote-release.server.ts) and the events live in
// auto-fixes-quote-send.server.ts.

/** Code switch (decision 354). Real owners still also need `customer_comms_enabled`. */
export const AUTO_FIXES_QUOTE_SEND_ENABLED: boolean = true;

/** One internal event per quote + reason when the automatic send is held (Needs me shows the latest reason). */
export const AUTO_FIXES_QUOTE_HELD_EVENT = "fixes_quote_auto_send_held";

export const AUTO_FIXES_HOLD = {
  notA4Priced: "Priced from the rate card, not by the electrician on the A4 form — check and send it",
  commsOff: "Customer messages are switched off (customer_comms_enabled) — not sent to the owner",
} as const;

export type AutoFixesFacts = {
  enabled: boolean;
  /** The A4 PIESA is Complete in Mitti with its evidence (assessments.mitti_completed). */
  a4Completed: boolean;
  /** The quote was built from the electrician's A4 total (quote_internals.calc_snapshot.pricing_source). */
  a4Priced: boolean;
  quote: { status: string; sent_at: string | null } | null;
  isTestJob: boolean;
  commsEnabled: boolean;
  /** The office Send checks (`rectificationSendBlocker` with the automatic review standing in for the office's). */
  sendBlocker: string | null;
  /** Decision 315: the quote waits for the electrician's fixes times (a normal wait, not an office item). */
  waitingForTimes: boolean;
};

export type AutoFixesDecision =
  | { action: "send" }
  | { action: "wait"; reason: string }
  | { action: "hold"; reason: string };

/** What to do with the job's latest fixes quote. `wait` = nothing for the office (not yet / already sent / switch off). */
export function autoFixesSendDecision(f: AutoFixesFacts): AutoFixesDecision {
  if (!f.enabled) return { action: "wait", reason: "Automatic fixes quote send is switched off" };
  if (!f.quote) return { action: "wait", reason: "No electrical fixes quote yet" };
  if (f.quote.status !== "draft" || f.quote.sent_at) return { action: "wait", reason: "Already sent or no longer a draft" };
  if (!f.a4Completed) return { action: "wait", reason: "The A4 safety check form is not Complete yet" };
  if (!f.a4Priced) return { action: "hold", reason: AUTO_FIXES_HOLD.notA4Priced };
  if (f.waitingForTimes) return { action: "wait", reason: "Waiting for the electrician's fixes times" };
  if (f.sendBlocker) return { action: "hold", reason: f.sendBlocker };
  if (!f.isTestJob && !f.commsEnabled) return { action: "hold", reason: AUTO_FIXES_HOLD.commsOff };
  return { action: "send" };
}

/** Stages where a completed A4 with repair work leaves a fixes quote to send (fixes routed, owner not yet approved). */
export const AUTO_FIXES_STAGES = ["piesa_complete", "electrical_variation_pending", "rectification_required"] as const;
