-- Stage 4 (Jo 23 Oct 2026): Mitti-first auto-pickup switch. OFF by default — the 15-minute sweep does
-- nothing until Jo switches it on. Pending: apply on the practice (PGlite) database first, then live with
-- Jo's go-ahead; the code fails closed (enabled:false) while the column is missing.
alter table workflow_settings
  add column if not exists mitti_pickup_auto_enabled boolean not null default false;
