-- Undo trade-messages-paused.sql. The code then treats trade messages as NOT paused (missing column).
DROP TRIGGER IF EXISTS trg_guard_trade_messages_paused ON public.workflow_settings;
DROP FUNCTION IF EXISTS public.guard_trade_messages_paused();
alter table public.workflow_settings drop column if exists trade_messages_paused;
