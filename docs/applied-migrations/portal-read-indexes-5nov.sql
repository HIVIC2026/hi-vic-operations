CREATE INDEX IF NOT EXISTS job_comms_customer_email_perf1105_idx
ON public.job_communications (job_id)
WHERE direction = 'outbound' AND channel = 'email' AND visibility = 'customer';

CREATE INDEX IF NOT EXISTS job_comms_more_photos_perf1105_idx
ON public.job_communications (job_id, source_reference, sent_at DESC)
WHERE direction = 'outbound' AND channel = 'email' AND visibility = 'customer'
AND source_event = 'office_more_photos_requested'
AND delivery_status IN ('recorded', 'sent', 'delivered');