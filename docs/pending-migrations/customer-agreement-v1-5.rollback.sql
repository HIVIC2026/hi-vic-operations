-- Run with psql -v ON_ERROR_STOP=1
-- Rollback for customer-agreement-v1-5.sql: removes the v1.5 customer_agreement row and re-activates v1.4 if nothing is
-- then active. The guard trigger makes templates permanent, so it is disabled inside this transaction only.
-- Do NOT roll back once any owner has signed v1.5 (signed copies point at it).
BEGIN;
ALTER TABLE public.compliance_templates DISABLE TRIGGER compliance_templates_guard;
DELETE FROM public.compliance_templates WHERE template_key = 'customer_agreement' AND version = '1.5';
UPDATE public.compliance_templates SET is_active = true
 WHERE template_key = 'customer_agreement' AND version = '1.4'
   AND NOT EXISTS (SELECT 1 FROM public.compliance_templates WHERE template_key = 'customer_agreement' AND is_active);
ALTER TABLE public.compliance_templates ENABLE TRIGGER compliance_templates_guard;
COMMIT;
