// Enquiries by where the website lead is up to (Jo 26 Oct 2026: "Enquiries are where the website leads come from. Then
// they get their auto response and they are offered to save their spot, so we need categories like spot saved, opted
// out, offered a spot"). The office does not ring leads and every lead gets the automatic response, so there is no
// "new" pile. Every open enquiry sits in exactly ONE category, worked out from facts the list already reads. Saved
// spots are jobs (Jobs › Choose installer) and not-eligible leads are closed (Jobs › Closed): the screen links there.
// No questions step (Jo 26 Oct 2026: "we don't ask for answers"; decision 392): an older lead that once got the 3
// questions email is simply "Offered a spot" here, like everyone else waiting on Save my spot.
// Gone quiet = nothing either way for 4 weeks: the day 2 / 7 / 21 reminders plus the 7-day close (decision 242) would
// have closed it, so these are leads we did reach and then heard nothing back from. A lead the automation never
// reached at all (no first response) is never Gone quiet, whatever its age (Jo 27 Oct 2026) — it stays "Email didn't
// send", where the office can still chase it.
// PURE: no I/O.

export type EnquiryCategory = "offered" | "not_sent" | "opted_out" | "quiet";
/** What the screen can ask for: one category, "active" (the default: still in the journey) or "all". */
export type EnquiryView = EnquiryCategory | "active" | "all";

export const ENQUIRY_CATEGORIES: readonly { key: EnquiryCategory; label: string; hint: string; active: boolean }[] = [
  { key: "offered", label: "Offered a spot", hint: "Estimate sent with the Save my spot offer. Reminders go out on day 2, 7 and 21.", active: true },
  { key: "not_sent", label: "Email didn't send", hint: "The automatic response failed or hasn't gone out yet. Failed sends are also on Needs me.", active: true },
  { key: "opted_out", label: "Opted out", hint: "The owner unsubscribed or said no thanks. Nothing more is sent.", active: false },
  { key: "quiet", label: "Gone quiet", hint: "No reply for 4 weeks or more, after the offer and reminders.", active: false },
];

export const ENQUIRY_VIEWS = ["active", "all", "offered", "not_sent", "opted_out", "quiet"] as const;

const DAY = 86_400_000;
export const QUIET_AFTER_DAYS = 28;

export type CategoryFacts = {
  createdAt: string;
  /** office_enquiry_index.enquiry_status (enquiry-groups.core EnquiryStatus). */
  enquiryStatus: string | null;
  /** Last confirmed customer contact; internal notes never count. */
  lastOutboundAt: string | null;
  /** Last time the owner reached us: an email matched to the job, or an older lead's answers. */
  lastOwnerAt: string | null;
  optedOut: boolean;
  /** The automatic first response failed. */
  sendFailed: boolean;
  /** No first response recorded yet (a recent lead waits for the sweep; an old one never got it). */
  noResponseYet: boolean;
  /** Latest owner email, separately from answers submitted on the website. */
  inboundAt?: string | null;
};

const t = (s: string | null) => (s ? Date.parse(s) : NaN);
export function unansweredOwnerEmail(inboundAt: string | null, repliedAt: string | null): boolean {
  const inbound = t(inboundAt), replied = t(repliedAt);
  return Number.isFinite(inbound) && (!Number.isFinite(replied) || replied <= inbound);
}

export function enquiryBulkCloseBlocker(f: CategoryFacts, now: number): string | null {
  if (f.noResponseYet) return "This enquiry has no confirmed first reply and cannot be bulk closed.";
  if (unansweredOwnerEmail(f.inboundAt ?? null, f.lastOutboundAt)) return "The owner's email has not been answered and cannot be bulk closed.";
  return CLOSABLE[enquiryCategory(f, now)] ? null : "This enquiry is no longer Gone quiet or Opted out.";
}

export function enquiryCategory(f: CategoryFacts, now: number): EnquiryCategory {
  if (f.optedOut) return "opted_out";
  if (f.sendFailed) return "not_sent";
  // Jo 27 Oct 2026: a lead that never got a first response is never "Gone quiet", whatever its age — it stays an
  // email to chase, so "Close all" (Gone quiet / Opted out only) can never close it.
  if (f.noResponseYet) return "not_sent";
  if (unansweredOwnerEmail(f.inboundAt ?? null, f.lastOutboundAt)) return "offered";
  const last = Math.max(...[t(f.lastOwnerAt), t(f.lastOutboundAt), t(f.createdAt)].filter(Number.isFinite));
  if (Number.isFinite(last) && now - last > QUIET_AFTER_DAYS * DAY) return "quiet";
  return "offered";
}

/** Order on the opening view: what may need the office first, then the waiting piles. */
export const CATEGORY_RANK: Record<EnquiryCategory, number> = { not_sent: 0, offered: 1, opted_out: 2, quiet: 3 };

export function inView(c: EnquiryCategory, v: EnquiryView): boolean {
  if (v === "all") return true;
  if (v === "active") return ENQUIRY_CATEGORIES.find((x) => x.key === c)?.active ?? false;
  return c === v;
}

export type CategoryCounts = Record<EnquiryCategory, number> & { active: number; all: number };

export function categoryCounts(cats: EnquiryCategory[]): CategoryCounts {
  const out: CategoryCounts = { offered: 0, not_sent: 0, opted_out: 0, quiet: 0, active: 0, all: cats.length };
  for (const c of cats) { out[c]++; if (inView(c, "active")) out.active++; }
  return out;
}

/** Categories whose enquiries the office can close in one go (they move to Jobs › Closed, history kept). */
export const CLOSABLE: Partial<Record<EnquiryCategory, string>> = { quiet: "No response", opted_out: "Owner opted out" };

export const WROTE_WITHIN_DAYS = 14;
/** "Wrote to us": the owner's latest email (matched to the job) is from the last 14 days and nothing went from us
 *  since. Returns when they wrote, or null. A marker on the row, not a group: it can sit in any category. */
export function ownerWrote(f: { inboundAt: string | null; lastOutboundAt: string | null }, now: number): string | null {
  const i = t(f.inboundAt), o = t(f.lastOutboundAt);
  if (!Number.isFinite(i) || now - i > WROTE_WITHIN_DAYS * DAY) return null;
  return Number.isFinite(o) && o > i ? null : f.inboundAt;
}
