-- Jo 1 Nov: data-only close-out; no delivery, no settings changes, no history deletion.
-- Apply only after the identical statement passes the isolated PGlite test.
WITH latest AS (
  SELECT DISTINCT ON (job_id) job_id, details
  FROM public.workflow_events
  WHERE event_type = 'spot_saved_confirmation_sent'
  ORDER BY job_id, created_at DESC, id DESC
), eligible AS (
  SELECT j.id, l.details
  FROM latest l
  JOIN public.jobs j ON j.id = l.job_id
  JOIN public.lead_campaign_responses r ON r.job_id = j.id
  WHERE j.source IS DISTINCT FROM 'qa_test'
    AND j.deleted_at IS NULL AND j.qa_archived_at IS NULL AND j.stage <> 'cancelled'
    AND r.spot_saved_at IS NOT NULL AND r.opted_out_at IS NULL
    AND l.details->'email'->>'status' IN ('sent', 'already')
    AND (
      l.details->'sms'->>'status' IN ('sent', 'already')
      OR (l.details->'sms'->>'status' = 'skipped' AND l.details->'sms'->>'detail' = 'No valid mobile')
      OR (l.details->'sms'->>'status' = 'blocked'
          AND l.details->'sms'->>'detail' ~ '^Too late to send.*\(limit 24h\)$'
          AND r.spot_saved_at < now() - interval '24 hours')
    )
    AND EXISTS (SELECT 1 FROM public.workflow_events a WHERE a.job_id = j.id
      AND a.event_type = 'spot_saved_confirmation_recovery_attempted' AND a.created_at >= '2026-10-31T00:00:00Z')
    AND NOT EXISTS (SELECT 1 FROM public.workflow_events c WHERE c.job_id = j.id
      AND c.event_type = 'spot_saved_confirmation_completed')
)
INSERT INTO public.workflow_events (job_id, event_type, summary, details, internal)
SELECT id, 'spot_saved_confirmation_completed',
  'Spot saved confirmation completed from recorded final outcomes; no messages sent',
  details || '{"recovery":true,"closeout":"Jo approved 1 Nov; no delivery"}'::jsonb, true
FROM eligible
RETURNING job_id;