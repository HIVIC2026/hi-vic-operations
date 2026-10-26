// Enquiries by where the website lead is up to (Jo 26 Oct 2026: "Enquiries are where the website leads come from. Then
// they get their auto response and they are offered to save their spot, so we need categories like spot saved, opted
// out, offered a spot"). The office does not ring leads and every lead gets the automatic response, so there is no
// "new" pile. Every open enquiry sits in exactly ONE category, worked out from facts the list already reads. Saved
// spots are jobs (Jobs › Choose installer) and not-eligible leads are closed (Jobs › Closed): the screen links there.
// Gone quiet = nothing either way for 4 weeks: the day 2 / 7 / 21 reminders plus the 7-day close (decision 242) would
// have closed it, so these are the enquiries the automation never reached (older than the reminder windows).
// PURE: no I/O.

export type EnquiryCategory = "offered" | "details_asked" | "details_answered" | "not_sent" | "opted_out" | "quiet";
/** What the screen can ask for: one category, "active" (the default: still in the journey) or "all". */
export type EnquiryView = EnquiryCategory | "active" | "all";

export const ENQUIRY_CATEGORIES: readonly { key: EnquiryCategory; label: string; hint: string; active: boolean }[] = [
  { key: "offered", label: "Offered a spot", hint: "Estimate sent with the Save my spot offer. Reminders go out on day 2, 7 and 21.", active: true },
  { key: "details_asked", label: "Asked for insulation details", hint: "We asked the 3 questions before we can offer a spot.", active: true },
  { key: "details_answered", label: "Answered the questions", hint: "The owner answered the 3 questions.", active: true },
  { key: "not_sent", label: "Email didn't send", hint: "The automatic response failed or hasn't gone out yet. Failed sends are also on Needs me.", active: true },
  { key: "opted_out", label: "Opted out", hint: "The owner unsubscribed or said no thanks. Nothing more is sent.", active: false },
  { key: "quiet", label: "Gone quiet", hint: "No reply for 4 weeks or more, after the offer and reminders.", active: false },
];

export const ENQUIRY_VIEWS = ["active", "all", "offered", "details_asked", "details_answered", "not_sent", "opted_out", "quiet"] as const;

const DAY = 86_400_000;
export const QUIET_AFTER_DAYS = 28;

export type CategoryFacts = {
  createdAt: string;
  /** office_enquiry_index.enquiry_status (enquiry-groups.core EnquiryStatus). */
  enquiryStatus: string | null;
  /** Last thing we sent or logged (email, text, call, note). */
  lastOutboundAt: string | null;
  /** Last time the owner reached us: an email matched to the job, or the 3 questions answered. */
  lastOwnerAt: string | null;
  answeredQuestions: boolean;
  optedOut: boolean;
  /** The automatic first response failed. */
  sendFailed: boolean;
  /** No first response recorded yet (a recent lead waits for the sweep; an old one never got it). */
  noResponseYet: boolean;
};

const t = (s: string | null) => (s ? Date.parse(s) : NaN);

export function enquiryCategory(f: CategoryFacts, now: number): EnquiryCategory {
  if (f.optedOut) return "opted_out";
  if (f.sendFailed) return "not_sent";
  const last = Math.max(...[t(f.lastOwnerAt), t(f.lastOutboundAt), t(f.createdAt)].filter(Number.isFinite));
  if (Number.isFinite(last) && now - last > QUIET_AFTER_DAYS * DAY) return "quiet";
  if (f.noResponseYet) return "not_sent";
  if (f.enquiryStatus === "insulation_requested") return f.answeredQuestions ? "details_answered" : "details_asked";
  return "offered";
}

/** Order on the opening view: what may need the office first, then the waiting piles. */
export const CATEGORY_RANK: Record<EnquiryCategory, number> = { not_sent: 0, details_answered: 1, offered: 2, details_asked: 3, opted_out: 4, quiet: 5 };

export function inView(c: EnquiryCategory, v: EnquiryView): boolean {
  if (v === "all") return true;
  if (v === "active") return ENQUIRY_CATEGORIES.find((x) => x.key === c)?.active ?? false;
  return c === v;
}

export type CategoryCounts = Record<EnquiryCategory, number> & { active: number; all: number };

export function categoryCounts(cats: EnquiryCategory[]): CategoryCounts {
  const out: CategoryCounts = { offered: 0, details_asked: 0, details_answered: 0, not_sent: 0, opted_out: 0, quiet: 0, active: 0, all: cats.length };
  for (const c of cats) { out[c]++; if (inView(c, "active")) out.active++; }
  return out;
}

/** Categories whose enquiries the office can close in one go (they move to Jobs › Closed, history kept). */
export const CLOSABLE: Partial<Record<EnquiryCategory, string>> = { quiet: "No response", opted_out: "Owner opted out" };
