-- Undo 2026-11-03_installer_added_electricians.sql. Electricians already added keep their rows; only the markers go.
alter table public.businesses drop column if exists installer_added_rejected_reason;
alter table public.businesses drop column if exists workcover_exempt_declared_at;
alter table public.businesses drop column if exists added_by_installer_business_id;
