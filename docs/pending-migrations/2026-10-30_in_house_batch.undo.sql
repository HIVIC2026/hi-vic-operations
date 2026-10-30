-- Schema rollback only; real assignment/job/email changes and permanent job history survive.
DROP FUNCTION IF EXISTS public.allocate_in_house_batch_job(uuid,uuid,uuid,uuid,uuid,uuid);
DELETE FROM public.customer_communication_templates
WHERE template_key='in_house_partner_will_call' AND version='in-house-batch-2026-10-30';
DROP TABLE IF EXISTS public.in_house_batches;