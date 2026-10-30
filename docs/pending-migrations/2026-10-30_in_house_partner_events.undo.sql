-- Remove only the two scoped backfill-history entries; preserve all other history.
DELETE FROM public.workflow_events
WHERE event_type = 'in_house_partner_backfilled'
AND details->>'business_id' IN ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0', '17793408-bf5c-4ddd-9bec-64199f64f9fb');