-- Rollback for 0089 electrician rates. Removes only objects created by 0089.
DROP FUNCTION IF EXISTS public.activate_electrician_rate(uuid, uuid);
DROP TABLE IF EXISTS public.electrician_rate_events;
DROP TABLE IF EXISTS public.electrician_rates;
DROP FUNCTION IF EXISTS public.guard_electrician_rate_event();
DROP FUNCTION IF EXISTS public.guard_electrician_rate();
