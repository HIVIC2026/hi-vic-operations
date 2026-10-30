-- WARNING: rolling back = UNPAUSED. Without the column the code treats trade messages as NOT paused, so texts and emails
-- to installers and electricians start going again straight away.
-- Undo trade-messages-paused.sql.
DROP TRIGGER IF EXISTS trg_guard_trade_messages_paused ON public.workflow_settings;
DROP FUNCTION IF EXISTS public.guard_trade_messages_paused();
alter table public.workflow_settings drop column if exists trade_messages_paused;
