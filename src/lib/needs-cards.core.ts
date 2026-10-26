// Needs me grouped by kind (Jo 26 Oct 2026, design review of the phone layout): inside Today / This week / Watch the
// rows sit in a few cards ("Quotes to check · 5", "Emails to sort · 23"), so the whole day fits on one phone screen.
// PURE: only regroups the rows office-needs.core already decided and sorted; never adds, drops or reorders a row
// inside its card. Cards come in the order of their most urgent row.

import type { NeedsKind, NeedsRow } from "./office-needs.core";

export type NeedsCardId = "offers" | "deadlines" | "quotes" | "final" | "failed" | "emails" | "electrician" | "owner" | "veec" | "payments" | "clock" | "other";

export const NEEDS_CARD_TITLE: Record<NeedsCardId, string> = {
  offers: "Offers to send again",
  deadlines: "Signatures and install deadlines",
  quotes: "Quotes to check",
  final: "Final check",
  failed: "Sends and forms that failed",
  emails: "Emails to sort",
  electrician: "Choose an electrician",
  owner: "Waiting on the owner or electrician",
  veec: "Rebate forms",
  payments: "Payments",
  clock: "Install clock and access",
  other: "Other",
};

const CARD_OF: Record<NeedsKind, NeedsCardId> = {
  choose_again: "offers", release_lapsed: "offers",
  sign_consent: "deadlines", esc_window: "deadlines", prestart_failed: "deadlines",
  quote_check: "quotes", fixes_quote_check: "quotes",
  final_check: "final",
  send_failed: "failed", robot_failed: "failed", piisa_form_failed: "failed", piesa_form_failed: "failed",
  email_change: "emails", email_unmatched: "emails",
  choose_installer: "other", choose_electrician: "electrician",
  piesa_owner_unsigned: "owner", piesa_fixes_owner_unsigned: "owner", fixes_times_missing: "owner",
  veec_a_held: "veec", veec_day_10: "veec",
  payment_not_in_xero: "payments", payment_overdue: "payments",
  ten_days_left: "clock", lapsed_window: "clock", second_no_access: "clock",
};

export const cardOf = (kind: NeedsKind): NeedsCardId => CARD_OF[kind] ?? "other";

export type NeedsCard = { id: NeedsCardId; title: string; rows: NeedsRow[]; oldestSince: string };

/** Rows (already most-urgent first) → cards in order of their first row; each card keeps its rows' order. */
export function needsCards(rows: NeedsRow[]): NeedsCard[] {
  const cards = new Map<NeedsCardId, NeedsCard>();
  for (const r of rows) {
    const id = cardOf(r.kind);
    const c = cards.get(id);
    if (c) { c.rows.push(r); if (r.since < c.oldestSince) c.oldestSince = r.since; }
    else cards.set(id, { id, title: NEEDS_CARD_TITLE[id], rows: [r], oldestSince: r.since });
  }
  return [...cards.values()];
}

/**
 * The line under the heading. Spots waiting for an installer are one queue (decision 378), not jobs that need the
 * office today, so they are named apart instead of swelling the count: "40 need you today · 325 spots waiting for an
 * installer".
 */
export function needsHeadline(today: number, waitingForInstaller: number): string {
  const head = today === 0 ? "Nothing needs you today" : `${today} need${today === 1 ? "s" : ""} you today`;
  return waitingForInstaller > 0 ? `${head} · ${waitingForInstaller} spot${waitingForInstaller === 1 ? "" : "s"} waiting for an installer` : head;
}

/**
 * "Match all best guesses" (Jo 26 Oct 2026): an unmatched email whose best guess rests on something specific — the HV
 * number, the street address or the owner's full name (outlook-guess.core) — is offered for one-tap matching in a review
 * list the office can untick. A surname, postcode or suburb alone is never enough. Each match still goes through the
 * same audited matchOutlookEmail as the row's own button.
 */
export function confidentGuess(row: Pick<NeedsRow, "kind" | "jobId" | "guessWhy">): boolean {
  if (row.kind !== "email_unmatched" || !row.jobId) return false;
  return (row.guessWhy ?? []).some((w) => /^(mentions |address |owner name )/.test(w));
}

export const bulkMatchable = (rows: NeedsRow[]): NeedsRow[] => rows.filter(confidentGuess);
