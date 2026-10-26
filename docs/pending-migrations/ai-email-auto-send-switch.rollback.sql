-- Rollback for ai-email-auto-send-switch.sql: removes the switch column. The code fails closed without it
-- (no automatic AI replies; Settings row not editable). Drafts and sent history (workflow_events) are untouched.
alter table public.workflow_settings
  drop column if exists ai_email_auto_send_enabled;
