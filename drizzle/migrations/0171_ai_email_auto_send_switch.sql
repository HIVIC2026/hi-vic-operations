alter table public.workflow_settings
  add column if not exists ai_email_auto_send_enabled boolean not null default false;