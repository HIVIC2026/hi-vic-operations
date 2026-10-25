-- Audit R06 (external review 25 Oct 2026, Jo approved the fix): ONE ledger row per payment receipt, enforced by the
-- database. The owner-payment ledger is append-only workflow_events (`owner_payment_recorded` / `owner_payment_reversed`,
-- decisions 139/368, audit F01). The server read the ledger, then inserted — two concurrent Stripe deliveries for one
-- PaymentIntent (checkout.session.completed + payment_intent.succeeded, or a retry) could both read an empty ledger and
-- both insert, crediting $698 for one $349 receipt.
-- Every new ledger row carries details->>'receipt_key' (payments.core.ts):
--   stripe:<PaymentIntent>                       card receipt (both Stripe event types resolve to the same key)
--   stripe-refund:<PaymentIntent>:<refunded>     one row per cumulative Stripe refund state
--   xero:<invoice>:<PaymentID>                   Xero payment
--   xero-reversal:<invoice>:<PaymentID>          Xero payment later deleted / voided
-- This unique index makes the second insert fail with 23505; the server (payments.server insertLedgerEvent) reads that as
-- "already recorded" and applies nothing twice. Rows written before this change have no receipt_key (NULL is never a
-- conflict), so the index builds on the live table whatever history it holds, and nothing is rewritten.
-- No table, column, check or trigger change: the log stays append-only. Idempotent (if not exists). Safe beside the other
-- workflow_events unique indexes (they cover details->>'idempotency_key' on other event types).
-- Until applied the server still checks the ledger before inserting (read-then-insert: covers sequential repeats only).
-- Proven on PGlite: tests/payment-receipt-once-practice-db.test.ts. Undo: payment-receipt-once.undo.sql.
create unique index if not exists workflow_events_payment_receipt_once_idx on public.workflow_events ((details->>'receipt_key'))
  where event_type in ('owner_payment_recorded', 'owner_payment_reversed') and details ? 'receipt_key';
