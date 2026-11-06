-- Launch blocker Task 7 (QA 7 Nov 2026) — PROPOSAL ONLY, NOT APPLIED. Jo approves before it runs live.
-- Installer bank changes need the office's OK before pay goes there. A change to an APPROVED account waits in these
-- three columns (the approved account stays the one we pay) until the office presses Approve, which copies them into
-- account_name / bsb / account_number and sets review_status = 'reviewed' (bank-approval.core.ts).
-- Nothing is backfilled: existing rows keep their account and review_status; all three new columns start NULL.
-- Before this runs, the portal falls back to the old write (live columns, review_status 'pending') — still held from pay
-- until the office approves. Proven on PGlite by tests/bank-change-approval.test.ts. Idempotent (IF NOT EXISTS).
-- Rollback: 2026-11-07-bank-change-pending-columns.rollback.sql.
ALTER TABLE public.business_bank_details
  ADD COLUMN IF NOT EXISTS pending_account_name text,
  ADD COLUMN IF NOT EXISTS pending_bsb text,
  ADD COLUMN IF NOT EXISTS pending_account_number text;
