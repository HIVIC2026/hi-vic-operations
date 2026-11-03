-- Part 2b: installers add their own electricians (Jo 3 Nov 2026). Three new columns on businesses.
-- Pending: run live only with Jo's OK. Code reads and writes these fail-closed (isMissingDbObject) until it is applied:
-- the "add an electrician" action refuses with "This feature isn't switched on yet." instead of half-inserting.
alter table public.businesses add column if not exists added_by_installer_business_id uuid null references public.businesses(id);
alter table public.businesses add column if not exists workcover_exempt_declared_at timestamptz null;
alter table public.businesses add column if not exists installer_added_rejected_reason text null;
