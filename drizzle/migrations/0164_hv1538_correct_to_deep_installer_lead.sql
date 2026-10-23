ALTER TABLE public.jobs DISABLE TRIGGER jobs_guard_source;
UPDATE public.jobs SET channel='installer_sourced',
  originating_installer_user_id='fa05a642-77da-4d09-9c3d-b2d5ef8e448a',
  originating_installer_business_id='a8304d2d-339b-4cbf-bcf1-fb09ce7935b0',
  commercial_model='not_configured'
WHERE id='24e58ac0-63b6-43ec-87c2-35cbdeace1a0' AND job_number='HV-1538' AND channel='hivic_sourced';
ALTER TABLE public.jobs ENABLE TRIGGER jobs_guard_source;
INSERT INTO public.workflow_events (job_id, actor_id, event_type, summary, details, internal)
VALUES ('24e58ac0-63b6-43ec-87c2-35cbdeace1a0','950fa0b6-dc44-49af-a754-6a65f26a661e','job_source_corrected',
 'Corrected 23 Oct: Deep''s own lead, not an HIV lead',
 '{"from":{"channel":"hivic_sourced","commercial_model":"hivic_invoices_owner"},"to":{"channel":"installer_sourced","originating_installer_user_id":"fa05a642-77da-4d09-9c3d-b2d5ef8e448a","originating_installer_business_id":"a8304d2d-339b-4cbf-bcf1-fb09ce7935b0","commercial_model":"not_configured"},"approved_by":"Jo Lowe","reason":"Chris Lowe only helped Deep fill the Mitti form"}'::jsonb, true);