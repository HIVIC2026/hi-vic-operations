-- 0147: allow the office photo/video review event (Jo, 8 Oct 2026). The Leads "Photos to check" worklist records
-- intake_media_reviewed with metadata.outcome below_r2 | over_r2 | unclear; the latest event decides the lead's group.
ALTER TABLE public.customer_engagement_events DROP CONSTRAINT IF EXISTS customer_engagement_events_event_type_check;
ALTER TABLE public.customer_engagement_events ADD CONSTRAINT customer_engagement_events_event_type_check
  CHECK (event_type = ANY (ARRAY['email_sent','email_delivered','email_opened','email_clicked','estimate_viewed','calculator_used','booking_started','booking_completed','followup_queued','followup_sent','followup_suppressed','email_bounced','email_failed','intake_media_reviewed']));
