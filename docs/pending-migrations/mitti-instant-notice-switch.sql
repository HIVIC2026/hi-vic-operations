-- Mitti instant notice: re-sync one job as soon as Mitti says a form changed. OFF by default.
-- Pending: prove on PGlite, run live only with Jo's OK. The code treats a missing column as OFF.
alter table public.workflow_settings add column if not exists mitti_instant_notice_enabled boolean not null default false;
