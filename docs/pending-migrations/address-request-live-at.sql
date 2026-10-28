-- Go-live switch for asking owners for a full address. Null = off. Not applied yet.
alter table public.workflow_settings add column if not exists address_request_live_at timestamptz;
