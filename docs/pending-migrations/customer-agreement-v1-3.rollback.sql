-- Rollback for customer-agreement-v1-3.sql: removes only the v1.3 customer_agreement row.
-- The guard trigger makes templates permanent, so it is disabled inside this transaction only.
BEGIN;
ALTER TABLE public.compliance_templates DISABLE TRIGGER compliance_templates_guard;
DELETE FROM public.compliance_templates WHERE template_key = 'customer_agreement' AND version = '1.3';
ALTER TABLE public.compliance_templates ENABLE TRIGGER compliance_templates_guard;
COMMIT;
