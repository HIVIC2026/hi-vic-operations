// Decision 366 (Jo 25 Oct 2026, audit F03): the owner's electrical fixes on My job (?screen=fixes). Pure: which step the
// owner is on and the words for it. One path: see the fixes quote → Approve → pay the fixes in full (card when Stripe is
// on, else bank transfer — the existing PayNowCard `fixes` step) → pick one of the electrician's offered times → booked.
// No I/O here; owner-fixes.server.ts reads the facts and owner-link.functions.ts carries the secure-link actions.

export type OwnerFixesStep = "none" | "approve" | "pay" | "pick" | "waiting_times" | "booking" | "booked" | "declined";

export type OwnerFixesFacts = {
  /** Latest fixes (rectification) quote the owner may see: issued / accepted / declined. Null = none. */
  quoteStatus: "issued" | "accepted" | "declined" | null;
  /** The fixes payment step is paid (or waived). */
  paid: boolean;
  /** Electrician fixes windows the owner can still pick (proposed, ≥24h away). */
  pickable: number;
  /** A window the owner already picked (accepted proposal) waiting to become the booking. */
  pickedAt: string | null;
  /** A confirmed (or completed) fixes visit. */
  bookedAt: string | null;
};

export function ownerFixesStep(f: OwnerFixesFacts): OwnerFixesStep {
  if (!f.quoteStatus) return "none";
  if (f.quoteStatus === "declined") return "declined";
  if (f.quoteStatus === "issued") return "approve";
  if (!f.paid) return "pay";
  if (f.bookedAt) return "booked";
  if (f.pickedAt) return "booking";
  return f.pickable > 0 ? "pick" : "waiting_times";
}

/** Plain words for each step (owner-facing, decision 140: never a card fee). */
export const OWNER_FIXES_COPY = {
  kicker: "Electrical fixes",
  title: "Your safety check found something to fix first",
  approve: "Check the fixes and their price below. If you're happy, approve them — you then pay for the fixes in full and pick a time for the electrician to come back.",
  approveTick: "I approve these electrical fixes and I'll pay the total in full now",
  approveButton: "Approve the fixes",
  pay: "Thanks — the fixes are approved. Pay for them in full now (card or bank transfer, no fee). Once your payment arrives you can pick the electrician's time.",
  pick: "Paid — thank you. Pick one of the electrician's times for the fixes visit.",
  pickButton: "Book this time",
  waitingTimes: "Paid — thank you. We're waiting for the electrician's available times; we'll let you know as soon as they're in.",
  booking: "Thanks — we're booking the time you picked. It will show here once it's confirmed.",
  booked: (when: string) => `Your fixes visit is booked for ${when}.`,
  declined: "You said no to the electrical fixes. We'll be in touch about what happens next.",
  homeButton: "See your electrical fixes",
} as const;

/** The Home card shows a button to the fixes screen only while the owner has something to do there. */
export const ownerFixesNeedsOwner = (s: OwnerFixesStep) => s === "approve" || s === "pay" || s === "pick";
