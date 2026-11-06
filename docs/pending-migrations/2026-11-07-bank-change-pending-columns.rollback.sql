-- Rollback for 2026-11-07-bank-change-pending-columns.sql. Any change still waiting for the office is dropped (the
-- approved account in account_name / bsb / account_number is untouched).
ALTER TABLE public.business_bank_details
  DROP COLUMN IF EXISTS pending_account_name,
  DROP COLUMN IF EXISTS pending_bsb,
  DROP COLUMN IF EXISTS pending_account_number;
