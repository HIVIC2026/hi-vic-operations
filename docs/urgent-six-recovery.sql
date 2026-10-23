WITH targets AS (
 SELECT s.* FROM public.customer_email_sends s JOIN public.jobs j ON j.id=s.job_id
 WHERE j.job_number IN ('HV-3127','HV-3131','HV-3132','HV-3133','HV-3135','HV-3152')
 AND s.status='failed' AND s.provider='not_sent' AND s.provider_message_id IS NULL AND s.sent_at IS NULL
 AND s.error='No approved Jo template applies to this enquiry — held for manual review; nothing sent.'
 AND s.idempotency_key='existing_leads_launch_v1:existing_insulation_save_spot:'||s.job_id::text
), audited AS (
 INSERT INTO public.workflow_events(job_id,actor_id,event_type,summary,details,internal)
 SELECT job_id,'a072d154-399d-42cc-9482-91680f15aab9','office_save_spot_recovery_approved',
 'Jo approved offering every new enquiry a spot, 23 Oct 6:13pm',
 jsonb_build_object('reason','Jo approved offering every new enquiry a spot, 23 Oct 6:13pm','failed_attempt',to_jsonb(targets),'no_photo_review',true),true FROM targets RETURNING job_id
)
UPDATE public.customer_email_sends s SET idempotency_key=s.idempotency_key||':held-not-sent:'||s.id::text
FROM targets t,audited a WHERE s.id=t.id AND a.job_id=t.job_id AND s.status='failed' AND s.provider='not_sent'
RETURNING s.job_id,s.id,s.status,s.idempotency_key;