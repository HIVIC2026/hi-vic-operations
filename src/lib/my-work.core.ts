// My work (installer home): one card per job, "Your turn" first. Pure; the Next step box decides each card.
import type { NextStepBox, NextStepKind } from "./next-step-box.core";

export type MyWorkCard = {
  jobId: string; owner: string; hvSuburb: string; pill: "Home Insulation Victoria lead" | "Your customer";
  step: string; reason: string; by: string | null; overdue: boolean; button: string | null; yours: boolean;
  /** Set only on the old-path job offer card: it opens the offer, not the job. */
  offerId?: string;
};
export type MyWorkRow = { jobId: string; jobNumber: string; owner: string | null; street: string | null; suburb: string | null; channel: string | null; box: NextStepBox; reason: string };
export type MyWorkOffer = { id: string; jobId: string; suburb: string | null; jobNumber?: string | null };

// Wording. Every line here is a DRAFT (no approved text yet) except where marked.
export const MY_WORK_WORDS = {
  greetingTitle: (business: string) => `Good morning, ${business} crew!`, // approved (Global Constraints)
  needYou: (n: number) => (n === 1 ? "1 job needs you today." : `${n} jobs need you today.`), // approved (Global Constraints)
  nothing: "Nothing needs you today.", // DRAFT
  leadPill: "Home Insulation Victoria lead" as const, // approved
  ownPill: "Your customer" as const, // approved
  offerStep: "Job offer", // DRAFT
  offerReason: "New offer", // DRAFT
  offerButton: "View offer", // DRAFT
  bookButton: "Book", // approved (plan Task 4 test)
  priceButton: "Price it", // approved (plan Task 4 test)
  ownerFallback: "Owner", // DRAFT
} as const;
const W = MY_WORK_WORDS;

export const greeting = (business: string, yourTurnCount: number): { title: string; sub: string } => ({
  title: W.greetingTitle(business), sub: yourTurnCount > 0 ? W.needYou(yourTurnCount) : W.nothing,
});

const REASON: Record<NextStepKind, string> = {
  book_ready_check: "New job", // approved (plan Task 4 test)
  ready_check_booked: "Ready Check booked", // DRAFT
  ready_check_missing: "Ready Check needs finishing", // DRAFT
  enter_price: "Ready Check done", // approved (plan Task 4 test)
  waiting_quote: "Waiting for the owner", // DRAFT
  book_piesa: "Owner said yes", // DRAFT
  waiting_electrician_book: "Waiting for the electrician", // DRAFT
  piesa_booked: "PIESA booked", // DRAFT
  upload_certificate: "Electrical upgrades", // DRAFT
  waiting_deposit: "Waiting for the deposit", // DRAFT
  book_install: "Deposit paid", // approved (plan Task 4 test)
  install_booked: "Install booked", // DRAFT
  install_locked: "Install locked in", // DRAFT
  after_install: "Install done", // DRAFT
  closed: "Closed", // DRAFT
};
export const reasonFor = (kind: NextStepKind): string => REASON[kind];

// Overdue first, then the earliest book-by date, cards with no date last. Stable otherwise.
function byUrgency(a: MyWorkCard, b: MyWorkCard): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.by && b.by) return a.by < b.by ? -1 : a.by > b.by ? 1 : 0;
  if (a.by || b.by) return a.by ? -1 : 1;
  return 0;
}

// The card's one button is short: "Book" for both booking steps, "Price it" for the price step.
const buttonFor = (b: NextStepBox): string | null => (b.kind === "enter_price" ? W.priceButton : b.kind === "book_install" ? W.bookButton : b.button);

export function offerCard(o: MyWorkOffer): MyWorkCard {
  const hv = [o.jobNumber, o.suburb].filter(Boolean).join(" · ");
  return { jobId: o.jobId, owner: W.ownerFallback, hvSuburb: hv, pill: W.leadPill, step: W.offerStep, reason: W.offerReason, by: null, overdue: false, button: W.offerButton, yours: true, offerId: o.id };
}

export function myWorkCards(rows: MyWorkRow[], offers: MyWorkOffer[] = []): { yourTurn: MyWorkCard[]; all: MyWorkCard[] } {
  const offerCards = offers.map(offerCard);
  const cards = rows.map((r): MyWorkCard => ({
    jobId: r.jobId, owner: r.owner?.trim() || W.ownerFallback,
    hvSuburb: [r.jobNumber, r.suburb].filter(Boolean).join(" · "),
    pill: r.channel === "installer_sourced" ? W.ownPill : W.leadPill,
    step: r.box.title, reason: r.reason, by: r.box.bookBy, overdue: r.box.overdue,
    button: buttonFor(r.box), yours: r.box.yours,
  }));
  const mine = cards.filter((c) => c.yours).sort(byUrgency);
  const rest = cards.filter((c) => !c.yours).sort(byUrgency);
  const yourTurn = [...offerCards, ...mine];
  return { yourTurn, all: [...yourTurn, ...rest] };
}

// Search ignores case, spaces and dashes, so "hv1234", "1234" and "HV-1234" all find HV-1234.
const squash = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function matchesSearch(card: MyWorkCard & { street: string | null }, q: string): boolean {
  const needle = squash(q);
  if (!needle) return true;
  return [card.owner, card.street, card.hvSuburb].some((part) => squash(part).includes(needle));
}
