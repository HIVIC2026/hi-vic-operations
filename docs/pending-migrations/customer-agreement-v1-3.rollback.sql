-- Run with psql -v ON_ERROR_STOP=1
-- Rollback for customer-agreement-v1-3.sql: removes the v1.3 customer_agreement row and, if nothing is then active,
-- re-activates the most recently approved older customer_agreement (the one the forward script retired).
-- The guard trigger makes templates permanent, so it is disabled inside this transaction only.
BEGIN;
ALTER TABLE public.compliance_templates DISABLE TRIGGER compliance_templates_guard;
DELETE FROM public.compliance_templates WHERE template_key = 'customer_agreement' AND version = '1.3';
UPDATE public.compliance_templates SET is_active = true
 WHERE id = (SELECT id FROM public.compliance_templates
              WHERE template_key = 'customer_agreement' AND approved AND approved_at IS NOT NULL
              ORDER BY approved_at DESC, created_at DESC LIMIT 1)
   AND NOT EXISTS (SELECT 1 FROM public.compliance_templates WHERE template_key = 'customer_agreement' AND is_active);
ALTER TABLE public.compliance_templates ENABLE TRIGGER compliance_templates_guard;
COMMIT;
