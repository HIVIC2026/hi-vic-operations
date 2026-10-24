-- Rollback for auto-offer-switches.sql: removes the two switches (automatic offers then read as OFF).
alter table public.workflow_settings drop column if exists auto_installer_offers;
alter table public.workflow_settings drop column if exists auto_electrician_offers;
