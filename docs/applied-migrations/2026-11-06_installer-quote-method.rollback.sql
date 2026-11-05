-- Rollback of installer-quote-method.sql: drops the audit trigger, its function, the check and the column.
-- The code reads a missing column as 'ready_check', so every installer goes back to Ready Checks.
-- The admin_config_events `quote_method_changed` rows already written stay (history).
DROP TRIGGER IF EXISTS trg_guard_quote_method ON public.businesses;
DROP FUNCTION IF EXISTS public.guard_quote_method();
alter table public.businesses drop constraint if exists businesses_quote_method_check;
alter table public.businesses drop column if exists quote_method;
