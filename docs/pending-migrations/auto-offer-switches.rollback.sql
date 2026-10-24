-- Rollback for auto-offer-switches.sql (decision 246). Drops only the two switch columns.
alter table public.workflow_settings
  drop column if exists auto_installer_offers,
  drop column if exists auto_electrician_offers;
