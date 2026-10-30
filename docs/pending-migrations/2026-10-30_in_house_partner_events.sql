-- Follow-up history only; do not apply without Jo's separate approval.
INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
SELECT NULL, NULL, 'in_house_partner_backfilled',
  'In-house partner flag set for existing in-house partner',
  jsonb_build_object('business_id', b.id, 'business_name', b.name,
    'old', jsonb_build_object('in_house', false),
    'new', jsonb_build_object('in_house', true, 'rectification_billed_by', 'hivic'),
    'reason', 'backfill from the previous hard-coded list'), true
FROM public.businesses b
WHERE b.id IN ('a8304d2d-339b-4cbf-bcf1-fb09ce7935b0', '17793408-bf5c-4ddd-9bec-64199f64f9fb')
AND NOT EXISTS (
  SELECT 1 FROM public.workflow_events e
  WHERE e.event_type = 'in_house_partner_backfilled' AND e.details->>'business_id' = b.id::text
);