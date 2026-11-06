ALTER TABLE public.workflow_events DISABLE TRIGGER workflow_events_immutable;
WITH ranked AS (
  SELECT id, lag(details) OVER (PARTITION BY job_id, event_type ORDER BY created_at, id) AS prev_details
  FROM public.workflow_events
  WHERE event_type IN ('mitti_product_recorded','mitti_electrician_recorded')
)
DELETE FROM public.workflow_events w USING ranked r
WHERE w.id = r.id AND r.prev_details IS NOT NULL AND w.details = r.prev_details;
ALTER TABLE public.workflow_events ENABLE TRIGGER workflow_events_immutable;