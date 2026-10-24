-- Undo 0227 (indexes only; no data changes).
DROP INDEX IF EXISTS public.job_assignments_business_active_idx;
DROP INDEX IF EXISTS public.partner_offers_business_status_idx;
DROP INDEX IF EXISTS public.bookings_business_status_idx;
DROP INDEX IF EXISTS public.business_members_user_idx;
