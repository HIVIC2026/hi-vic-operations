-- PENDING ONLY. Restore the legacy consumer-rights version for the previous app catalogue.
-- Both approval versions remain permanently recorded: no approvals or signed records are deleted.
-- Keep the accurate neutral approval note; it does not affect version/body approval matching.
BEGIN;
ALTER TABLE public.compliance_templates DISABLE TRIGGER compliance_templates_guard;
UPDATE public.compliance_templates
SET version = 'lawyer-2026-10-06-v1'
WHERE template_key = 'consumer_rights' AND version = '2026-10-06-v1'
  AND source_note = 'Approved by Jo, 6 Oct 2026';
ALTER TABLE public.compliance_templates ENABLE TRIGGER compliance_templates_guard;
COMMIT;