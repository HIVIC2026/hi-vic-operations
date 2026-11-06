// Launch blocker Task 7 (QA 7 Nov 2026): installer bank changes need the office's OK before pay goes there. PURE rules.
// `business_bank_details` keeps ONE approved (live) account; a change to an approved account waits in `pending_*`
// (pending migration 2026-11-07-bank-change-pending-columns.sql) until the office presses Approve. The existing
// `review_status` CHECK allows only 'pending' | 'reviewed': 'reviewed' (with reviewed_by / reviewed_at) is the office's OK.

export const BANK_APPROVED_STATUS = "reviewed";
/** Partners and Needs me words (launch blocker plan Task 7). */
export const BANK_CHANGE_WAITING = "Bank change waiting";
export const BANK_CHANGE_TO_CHECK = "Bank change to check";
/** Existing office wording (office-partners.core application checks) for a business with no bank details on file. */
export const BANK_NOT_GIVEN = "Bank details not given (collected after approval)";

export type BankRow = {
  business_id?: string; account_name: string | null; bsb: string | null; account_number: string | null; review_status: string | null;
  pending_account_name?: string | null; pending_bsb?: string | null; pending_account_number?: string | null;
};
export type BankInput = { account_name: string; bsb: string; account_number: string };
export type BankAccount = { accountName: string; bsb: string; accountNumber: string };

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const same = (a: BankInput, b: { account_name: string | null; bsb: string | null; account_number: string | null }) =>
  a.account_name.trim() === (b.account_name ?? "").trim() && digits(a.bsb) === digits(b.bsb) && digits(a.account_number) === digits(b.account_number);

/** The account the office may pay: the live account once the office approved it; never a pending change. */
export function approvedBankAccount(row: BankRow | null | undefined): BankAccount | null {
  if (!row || row.review_status !== BANK_APPROVED_STATUS || !row.account_name || !row.bsb || !row.account_number) return null;
  return { accountName: row.account_name, bsb: row.bsb, accountNumber: row.account_number };
}

/** A change the office still has to check: first details never approved, or a change waiting beside an approved account. */
export function bankChangeWaiting(row: BankRow | null | undefined): boolean {
  if (!row) return false;
  return row.review_status !== BANK_APPROVED_STATUS || !!row.pending_account_number;
}

/** Why a payout to this business can't be marked paid yet (null = an approved account is on file). Fails closed. */
export function payoutBankHold(row: BankRow | null | undefined): string | null {
  if (!row) return BANK_NOT_GIVEN;
  return approvedBankAccount(row) ? null : BANK_CHANGE_WAITING;
}

/** What an installer's save writes. With an approved account on file the change waits in pending_* (the approved account
 *  stays the one we pay); entering the approved account again clears any waiting change. Otherwise the live columns are
 *  written and wait for the office (review_status 'pending'). */
export function bankSaveWrite(existing: BankRow | null | undefined, input: BankInput):
  | { mode: "pending"; patch: { pending_account_name: string | null; pending_bsb: string | null; pending_account_number: string | null }; cleared: boolean }
  | { mode: "live" } {
  if (!approvedBankAccount(existing)) return { mode: "live" };
  if (same(input, existing!)) return { mode: "pending", patch: { pending_account_name: null, pending_bsb: null, pending_account_number: null }, cleared: true };
  return { mode: "pending", patch: { pending_account_name: input.account_name, pending_bsb: input.bsb, pending_account_number: input.account_number }, cleared: false };
}

/** The office Approve: a waiting change moves into the live columns; first details are simply approved. null = nothing waiting. */
export function bankApprovePatch(row: BankRow | null | undefined, actorId: string, nowIso: string): Record<string, unknown> | null {
  if (!row || !bankChangeWaiting(row)) return null;
  const reviewed = { review_status: BANK_APPROVED_STATUS, reviewed_by: actorId, reviewed_at: nowIso };
  if (row.pending_account_number && row.pending_bsb && row.pending_account_name) {
    return { account_name: row.pending_account_name, bsb: row.pending_bsb, account_number: row.pending_account_number, pending_account_name: null, pending_bsb: null, pending_account_number: null, updated_by: actorId, updated_at: nowIso, ...reviewed };
  }
  return reviewed;
}
