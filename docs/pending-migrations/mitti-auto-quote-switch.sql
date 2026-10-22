-- Stage 6 (Jo 23 Oct 2026): the automatic Ready Check → owner quote switch. OFF by default — a finished
-- Ready Check prepares nothing until Jo switches it on. Pending: prove on the practice (PGlite) database
-- first, then apply live with Jo's go-ahead; the code fails closed (no auto-quote) while the column is missing.
alter table workflow_settings
  add column if not exists mitti_auto_quote_enabled boolean not null default false;
