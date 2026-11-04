-- Rollback of 2026-11-02-credential-amount-insured.sql: drops the amount column and its check. Nothing else changes.
alter table public.business_credentials drop constraint if exists business_credentials_amount_insured_aud_check;
alter table public.business_credentials drop column if exists amount_insured_aud;
