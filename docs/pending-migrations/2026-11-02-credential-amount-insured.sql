-- New job flow Part 9 Task 8 (Jo 2 Nov 2026): public liability cover must be $5m or more. The office types the amount
-- insured (AUD) when it approves the certificate on My business / Partners; `businessDocsBlocker` (trade-expiry.core)
-- blocks bookings, Add a job, offers and the pre-start check while the latest VERIFIED public liability row has no
-- amount or an amount under 5,000,000. Null = not recorded (blocked), never "assumed enough".
-- OPTIONAL for go-live (G6 B1, 4 Nov 2026): the live database already records every business's cover on
-- businesses.public_liability_cover_amount, and business-docs.server reads that when the verified row has no amount of
-- its own. This file only adds a per-row override; skip it on deploy day unless the office wants to type amounts per row.
-- Pending: proven on PGlite (tests/new-flow-09-credential-amount.pglite.test.ts); run live only with Jo's OK.
-- Rollback: 2026-11-02-credential-amount-insured.rollback.sql.
alter table public.business_credentials add column if not exists amount_insured_aud numeric null;
alter table public.business_credentials drop constraint if exists business_credentials_amount_insured_aud_check;
alter table public.business_credentials add constraint business_credentials_amount_insured_aud_check check (amount_insured_aud is null or amount_insured_aud >= 0);
comment on column public.business_credentials.amount_insured_aud is 'Amount insured in AUD, typed by the office when verifying (public liability must be >= 5,000,000). Null = not recorded.';
