// My work (installer home): one card per job, "Your turn" first. Pure; the Next step box decides each card.
import { NEXT_STEP_WORDS, type NextStepBox, type NextStepKind } from "./next-step-box.core";
import { quoteExpiresAt } from "./quote-expiry.core";

export type MyWorkCard = {
  jobId: string; owner: string; hvSuburb: string; pill: "Home Insulation Victoria lead" | "Your customer";
  step: string; reason: string; by: string | null; overdue: boolean; button: string | null; yours: boolean;
};
export type MyWorkRow = { jobId: string; jobNumber: string; owner: string | null; street: string | null; suburb: string | null; channel: string | null; box: NextStepBox; reason: string; mittiLinked?: boolean; mittiRequested?: boolean; quoteSentAt?: string | null };

// Wording. Every line here is a DRAFT (no approved text yet) except where marked.
export const MY_WORK_WORDS = {
  greetingTitle: (business: string) => `Hi, ${business} team`, // Jo 5 Nov: neutral greeting stays correct at any Melbourne time.
  needYou: (n: number) => (n === 1 ? "1 job needs you today." : `${n} jobs need you today.`), // approved (Global Constraints)
  nothing: "Nothing needs you today.", // DRAFT
  leadPill: "Home Insulation Victoria lead" as const, // approved
  ownPill: "Your customer" as const, // approved
  bookButton: "Book", // approved (plan Task 4 test)
  priceButton: "Price it", // approved (plan Task 4 test)
  ownerFallback: "Owner", // DRAFT
} as const;
const W = MY_WORK_WORDS;

/** A TEST partner's name without its TEST mark ("TEST Rapid" / "[TEST PARTNER] Rapid" → "Rapid"), as the other screens print it. */
export const crewName = (business: string): string => business.replace(/^\s*(?:\[TEST PARTNER\]\s*|TEST\b\s*)+/i, "").trim() || business;
export const greeting = (business: string, yourTurnCount: number): { title: string; sub: string } => ({
  title: W.greetingTitle(crewName(business)), sub: yourTurnCount > 0 ? W.needYou(yourTurnCount) : W.nothing,
});

const REASON: Record<NextStepKind, string> = {
  own_ready_check: "Ready Check",
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
  quote_from_photos: "Quote from photos", // DRAFT (photo-quote installers, Jo 5 Nov 2026)
};
/** `box` (fix wave I5): a "waiting_quote" box before any quote has gone is "Ready Check done" (approved), not "Waiting for the owner". */
/** `photos`: a From photos job never says "Ready Check done" — its quote-being-prepared card reads "Photo quote sent" (DRAFT). */
export const reasonFor = (kind: NextStepKind, box?: Pick<NextStepBox, "title">, photos = false): string =>
  kind === "waiting_quote" && box?.title.startsWith(NEXT_STEP_WORDS.quotePreparingTitle) ? (photos ? "Photo quote sent" : REASON.enter_price) : REASON[kind];

/** The My work card reason from the same facts as the box: any photo job (a From photos give OR an installer's own photo
 *  quote) reads "Photo quote sent", never "Ready Check done" (review fix round). */
export const myWorkReason = (box: Pick<NextStepBox, "kind" | "title">, facts: { quoteMethod?: string | null }): string => reasonFor(box.kind, box, facts.quoteMethod === "photos");

// Overdue first, then the earliest book-by date, cards with no date last. Stable otherwise.
function byUrgency(a: MyWorkCard, b: MyWorkCard): number {
  if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
  if (a.by && b.by) return a.by < b.by ? -1 : a.by > b.by ? 1 : 0;
  if (a.by || b.by) return a.by ? -1 : 1;
  return 0;
}

// The card's one button is short: "Book" for both booking steps, "Price it" for the price step.
const buttonFor = (b: NextStepBox): string | null => (b.kind === "enter_price" ? W.priceButton : b.kind === "book_install" ? W.bookButton : b.button);

const shortDate = (at: Date): string => new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short" }).format(at);

/** My work only: own-customer early actions have no Ready Check booking clock. Later boxes stay canonical. */
function ownCustomerCard(r: MyWorkRow): Partial<MyWorkCard> {
  if (r.channel !== "installer_sourced") return {};
  const noDeadline = { by: null, overdue: false };
  if (r.box.kind === "own_ready_check") return {
    ...noDeadline, step: "Measure and quote", reason: r.mittiLinked ? 'New job · Mitti form ready' : r.mittiRequested ? 'New job · Mitti form on its way' : 'New job',
    button: "Measure and quote", yours: true,
  };
  if (r.box.kind === "enter_price") return {
    ...noDeadline, step: "Enter your price", reason: "Mitti form done", button: "Enter price", yours: true,
  };
  if (r.box.kind === "waiting_quote" && r.quoteSentAt) {
    const sent = new Date(r.quoteSentAt);
    if (!Number.isFinite(sent.getTime())) return {};
    const validUntil = new Date(quoteExpiresAt(sent).getTime() - 1);
    return { ...noDeadline, step: "Quote sent", reason: `Sent ${shortDate(sent)} · valid until ${shortDate(validUntil)}`, button: "See the quote", yours: false };
  }
  if (r.box.kind === "waiting_quote" && r.box.title.startsWith(NEXT_STEP_WORDS.quotePreparingTitle)) return {
    ...noDeadline, step: "Quote being prepared", reason: "Home Insulation Victoria is checking it", button: null, yours: false,
  };
  return {};
}

// Part 7 Task 9 (join 4 Nov 2026): nobody is offered a job any more (the installer calls the owner and books), so there is
// no "Job offer" card and no /field/offer link; a leftover pending offer is the office's to close by hand.
export function myWorkCards(rows: MyWorkRow[]): { yourTurn: MyWorkCard[]; all: MyWorkCard[] } {
  const cards = rows.map((r): MyWorkCard => ({
    jobId: r.jobId, owner: r.owner?.trim() || W.ownerFallback,
    hvSuburb: [r.jobNumber, r.suburb].filter(Boolean).join(" · "),
    pill: r.channel === "installer_sourced" ? W.ownPill : W.leadPill,
    step: r.box.title, reason: r.reason, by: r.box.bookBy, overdue: r.box.overdue,
    button: buttonFor(r.box), yours: r.box.yours,
    ...ownCustomerCard(r),
  }));
  const mine = cards.filter((c) => c.yours).sort(byUrgency);
  const rest = cards.filter((c) => !c.yours).sort(byUrgency);
  const yourTurn = mine;
  return { yourTurn, all: [...yourTurn, ...rest] };
}

// Search ignores case, spaces and dashes, so "hv1234", "1234" and "HV-1234" all find HV-1234.
const squash = (s: string | null | undefined): string => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
export function matchesSearch(card: MyWorkCard & { street: string | null }, q: string): boolean {
  const needle = squash(q);
  if (!needle) return true;
  return [card.owner, card.street, card.hvSuburb].some((part) => squash(part).includes(needle));
}
