CREATE INDEX admin_config_events_type_created_idx ON public.admin_config_events (event_type, created_at DESC);
CREATE INDEX admin_config_events_actor_created_idx ON public.admin_config_events (actor_id, created_at DESC);
CREATE INDEX admin_config_events_business_idx ON public.admin_config_events ((details->>'business_id')) WHERE details->>'business_id' IS NOT NULL;
CREATE INDEX bookings_status_start_idx ON public.bookings (status, scheduled_start);
CREATE INDEX bookings_kind_status_idx ON public.bookings (kind, status);
CREATE INDEX bookings_job_kind_status_idx ON public.bookings (job_id, kind, status);