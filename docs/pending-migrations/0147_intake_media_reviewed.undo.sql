-- Undo 0147: remove the intake_media_reviewed event type again (only safe when no such rows exist).
ALTER TABLE public.customer_engagement_events DROP CONSTRAINT IF EXISTS customer_engagement_events_event_type_check;
ALTER TABLE public.customer_engagement_events ADD CONSTRAINT customer_engagement_events_event_type_check
  CHECK (event_type = ANY (ARRAY['email_sent','email_delivered','email_opened','email_clicked','estimate_viewed','calculator_used','booking_started','booking_completed','followup_queued','followup_sent','followup_suppressed','email_bounced','email_failed']));
