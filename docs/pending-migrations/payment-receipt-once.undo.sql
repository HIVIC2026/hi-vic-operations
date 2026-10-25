-- Undo for payment-receipt-once.sql (audit R06): drops only the once-per-receipt unique index. Ledger rows already written
-- stay (workflow_events is append-only); without the index the server falls back to its read-then-insert check, which
-- does not stop two CONCURRENT deliveries of one receipt.
drop index if exists public.workflow_events_payment_receipt_once_idx;
